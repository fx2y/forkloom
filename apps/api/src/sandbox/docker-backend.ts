import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { hashBytes } from "@forkloom/shared";
import { DockerCli } from "./docker-cli";
import type {
	ExecResult,
	ExecSpec,
	RunnerBackend,
	SandboxArtifactPointer,
	SandboxDestroyMode,
	SandboxExecStatus,
	SandboxModel,
	SandboxMountSpec,
	SandboxSpecModel,
	SandboxState,
	SnapshotRule,
} from "./ports";
import { createSandboxPreviewSpec, needsSandboxApproval } from "./profile";

type DockerInspectState = {
	Status?: string | undefined;
	Running?: boolean | undefined;
};

type DockerInspectContainer = {
	Id?: string | undefined;
	Name?: string | undefined;
	State?: DockerInspectState | undefined;
};

type DockerBackendDeps = {
	dockerCli?: DockerCli | undefined;
	now?: (() => Date) | undefined;
	writeSnapshot?:
		| ((
				body: Buffer,
				meta: {
					sandboxId: string;
					include: string[];
					exclude: string[];
				},
		  ) => Promise<SandboxArtifactPointer>)
		| undefined;
};

type CapturedTail = {
	text: string;
	bytes: number;
};

function asIso(now: Date): string {
	return now.toISOString();
}

function toBindSource(source: string): string {
	return isAbsolute(source) ? source : resolve(source);
}

function toCpuString(cpuMillicores: number): string {
	return (cpuMillicores / 1000).toFixed(3).replace(/\.?0+$/u, "");
}

function retainTail(
	previous: Buffer<ArrayBufferLike>,
	chunk: Uint8Array,
	limit: number,
): Buffer<ArrayBufferLike> {
	if (limit <= 0) {
		return Buffer.alloc(0);
	}
	const combined = Buffer.concat([previous, Buffer.from(chunk)]);
	if (combined.byteLength <= limit) {
		return Buffer.from(combined);
	}
	return Buffer.from(combined.subarray(combined.byteLength - limit));
}

function captureTail(buffer: Buffer<ArrayBufferLike>): CapturedTail {
	return {
		text: buffer.toString("utf8"),
		bytes: buffer.byteLength,
	};
}

function toSandboxModel(
	spec: SandboxSpecModel,
	state: SandboxState,
	now: Date,
): SandboxModel {
	return {
		runId: spec.runId,
		sandboxId: spec.sandboxId,
		backend: spec.backend,
		profile: spec.profile,
		state,
		approvalState: needsSandboxApproval(spec.profile)
			? "pending"
			: "not_required",
		spec,
		previewSpec: createSandboxPreviewSpec(spec),
		containerName: spec.containerName,
		workVolume: spec.workVolume,
		inflightWorkflowId: null,
		leaseExpiresAt: null,
		workspaceRef: undefined,
		createdAt: asIso(now),
		updatedAt: asIso(now),
		lastSeenAt: asIso(now),
	};
}

async function ensureMountSource(mount: SandboxMountSpec): Promise<void> {
	if (mount.kind === "work") {
		return;
	}
	await mkdir(toBindSource(mount.source), { recursive: true });
}

function toRunMountArgs(mount: SandboxMountSpec, workdir: string): string[] {
	if (mount.kind === "work") {
		return ["--mount", `type=volume,source=${mount.source},target=${workdir}`];
	}
	const options = [
		"type=bind",
		`source=${toBindSource(mount.source)}`,
		`target=${mount.dest}`,
	];
	if (mount.mode === "ro") {
		options.push("readonly");
	}
	return ["--mount", options.join(",")];
}

export class DockerBackend implements RunnerBackend {
	private readonly dockerCli: DockerCli;
	private readonly now: () => Date;
	private readonly writeSnapshot:
		| ((
				body: Buffer,
				meta: {
					sandboxId: string;
					include: string[];
					exclude: string[];
				},
		  ) => Promise<SandboxArtifactPointer>)
		| undefined;

	constructor(deps: DockerBackendDeps = {}) {
		this.dockerCli = deps.dockerCli ?? new DockerCli();
		this.now = deps.now ?? (() => new Date());
		this.writeSnapshot = deps.writeSnapshot;
	}

	async ensure(spec: SandboxSpecModel): Promise<SandboxModel> {
		return this.ensureSandbox(spec);
	}

	async ensureSandbox(spec: SandboxSpecModel): Promise<SandboxModel> {
		await this.ensureVolume(spec.workVolume);
		for (const mount of spec.mounts) {
			await ensureMountSource(mount);
		}
		const inspected = await this.inspectContainer(spec.containerName);
		if (!inspected) {
			await this.createSandbox(spec);
			return toSandboxModel(spec, "ready", this.now());
		}
		if (inspected.State?.Running) {
			return toSandboxModel(spec, "ready", this.now());
		}
		await this.wakeSandbox(spec);
		return toSandboxModel(spec, "ready", this.now());
	}

	async wakeSandbox(spec: SandboxSpecModel): Promise<void> {
		const result = await this.dockerCli.capture(["start", spec.containerName]);
		if (result.exitCode !== 0) {
			throw new Error(
				result.stderr.toString("utf8").trim() || "docker start failed",
			);
		}
	}

	async sleepSandbox(handle: SandboxModel): Promise<SandboxModel> {
		const result = await this.dockerCli.capture([
			"stop",
			"-t",
			"1",
			handle.containerName,
		]);
		if (result.exitCode !== 0) {
			throw new Error(
				result.stderr.toString("utf8").trim() || "docker stop failed",
			);
		}
		return {
			...handle,
			state: "sleeping",
			updatedAt: asIso(this.now()),
			lastSeenAt: asIso(this.now()),
		};
	}

	async recreateSandbox(
		handle: SandboxModel,
		restoreArchive?: Buffer | undefined,
	): Promise<SandboxModel> {
		await this.removeContainer(handle.containerName);
		await this.createSandbox(handle.spec);
		if (restoreArchive) {
			await this.restoreArchive(handle.spec, restoreArchive);
		}
		return {
			...handle,
			state: "ready",
			updatedAt: asIso(this.now()),
			lastSeenAt: asIso(this.now()),
		};
	}

	async destroy(
		handle: SandboxModel,
		mode: SandboxDestroyMode,
	): Promise<SandboxModel | null> {
		return this.destroySandbox(handle, mode);
	}

	async destroySandbox(
		handle: SandboxModel,
		mode: SandboxDestroyMode,
	): Promise<SandboxModel | null> {
		if (mode === "sleep") {
			return this.sleepSandbox(handle);
		}
		await this.removeContainer(handle.containerName);
		await this.dockerCli.capture(["volume", "rm", "-f", handle.workVolume]);
		return null;
	}

	async exec(handle: SandboxModel, spec: ExecSpec): Promise<ExecResult> {
		const startedAt = asIso(this.now());
		const args = [
			"exec",
			"-i",
			"-w",
			spec.cwd,
			...this.toEnvArgs(spec.env),
			handle.containerName,
			...spec.cmd,
		];
		const process = this.dockerCli.spawn(args);
		let stdoutTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
		let stderrTail: Buffer<ArrayBufferLike> = Buffer.alloc(0);
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let timedOut = false;

		process.stdout.on("data", (chunk: Uint8Array) => {
			stdoutBytes += chunk.byteLength;
			stdoutTail = retainTail(stdoutTail, chunk, spec.maxBytesOut);
		});
		process.stderr.on("data", (chunk: Uint8Array) => {
			stderrBytes += chunk.byteLength;
			stderrTail = retainTail(stderrTail, chunk, spec.maxBytesOut);
		});

		if (spec.stdinText != null) {
			process.stdin.end(spec.stdinText);
		} else {
			process.stdin.end();
		}

		const timeoutTimer = setTimeout(() => {
			timedOut = true;
			void this.dockerCli.capture(["kill", handle.containerName]);
			process.kill("SIGKILL");
		}, spec.timeoutSec * 1000);

		const exitCode = await new Promise<number>((resolveExit, reject) => {
			process.once("error", reject);
			process.once("exit", (code) => resolveExit(code ?? 137));
		}).finally(() => clearTimeout(timeoutTimer));

		const endedAt = asIso(this.now());
		const stdout = captureTail(stdoutTail);
		const stderr = captureTail(stderrTail);
		return {
			exitCode,
			status: toExecStatus(exitCode, timedOut),
			stdoutTail: stdout.text,
			stderrTail: stderr.text,
			stdoutBytes,
			stderrBytes,
			startedAt,
			endedAt,
			timeoutSec: spec.timeoutSec,
			maxBytesOut: spec.maxBytesOut,
		};
	}

	async snapshot(
		handle: SandboxModel,
		rule: SnapshotRule,
	): Promise<SandboxArtifactPointer> {
		const args = [
			"exec",
			handle.containerName,
			"tar",
			"-C",
			handle.spec.workdir,
			"-czf",
			"-",
			...rule.exclude.flatMap((entry) => ["--exclude", entry]),
			...rule.include,
		];
		const result = await this.dockerCli.capture(args);
		if (result.exitCode !== 0) {
			throw new Error(
				result.stderr.toString("utf8").trim() || "docker snapshot failed",
			);
		}
		if (this.writeSnapshot) {
			return this.writeSnapshot(result.stdout, {
				sandboxId: handle.sandboxId,
				include: rule.include,
				exclude: rule.exclude,
			});
		}
		return { sha256: hashBytes(result.stdout) };
	}

	private async createSandbox(spec: SandboxSpecModel): Promise<void> {
		const args = [
			"run",
			"-d",
			"--name",
			spec.containerName,
			"--workdir",
			spec.workdir,
			"--cpus",
			toCpuString(spec.cpuMillicores),
			"--memory",
			`${spec.memoryMb}m`,
			...(spec.network === "off" ? ["--network", "none"] : []),
			...spec.mounts.flatMap((mount) => toRunMountArgs(mount, spec.workdir)),
			...this.toEnvArgs(spec.env),
			spec.imageDigest,
			"tail",
			"-f",
			"/dev/null",
		];
		const result = await this.dockerCli.capture(args);
		if (result.exitCode !== 0) {
			throw new Error(
				result.stderr.toString("utf8").trim() || "docker run failed",
			);
		}
	}

	private async restoreArchive(
		spec: SandboxSpecModel,
		archive: Buffer,
	): Promise<void> {
		const tempDir = await mkdtemp(join(tmpdir(), "forkloom-snapshot-"));
		const archivePath = resolve(tempDir, "workspace.tgz");
		try {
			await writeFile(archivePath, archive);
			const copy = await this.dockerCli.capture([
				"cp",
				archivePath,
				`${spec.containerName}:/tmp/forkloom-workspace.tgz`,
			]);
			if (copy.exitCode !== 0) {
				throw new Error(
					copy.stderr.toString("utf8").trim() || "docker cp failed",
				);
			}
			const untar = await this.dockerCli.capture([
				"exec",
				spec.containerName,
				"tar",
				"-C",
				spec.workdir,
				"-xzf",
				"/tmp/forkloom-workspace.tgz",
			]);
			if (untar.exitCode !== 0) {
				throw new Error(
					untar.stderr.toString("utf8").trim() || "docker restore failed",
				);
			}
		} finally {
			await rm(tempDir, { recursive: true, force: true });
		}
	}

	private async ensureVolume(name: string): Promise<void> {
		const inspected = await this.dockerCli.capture(["volume", "inspect", name]);
		if (inspected.exitCode === 0) {
			return;
		}
		const created = await this.dockerCli.capture(["volume", "create", name]);
		if (created.exitCode !== 0) {
			throw new Error(
				created.stderr.toString("utf8").trim() || "docker volume create failed",
			);
		}
	}

	private async inspectContainer(
		name: string,
	): Promise<DockerInspectContainer | null> {
		const result = await this.dockerCli.capture(["inspect", name]);
		if (result.exitCode !== 0) {
			return null;
		}
		const parsed = JSON.parse(result.stdout.toString("utf8")) as unknown;
		if (!Array.isArray(parsed) || parsed.length === 0) {
			return null;
		}
		return (parsed[0] ?? null) as DockerInspectContainer | null;
	}

	private async removeContainer(name: string): Promise<void> {
		await this.dockerCli.capture(["rm", "-f", name]);
	}

	private toEnvArgs(env: Record<string, string> | undefined): string[] {
		if (!env) {
			return [];
		}
		return Object.entries(env).flatMap(([key, value]) => [
			"-e",
			`${key}=${value}`,
		]);
	}
}

function toExecStatus(exitCode: number, timedOut: boolean): SandboxExecStatus {
	if (timedOut || exitCode === 137) {
		return "aborted";
	}
	return exitCode === 0 ? "done" : "failed";
}
