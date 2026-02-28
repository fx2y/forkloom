import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
	DockerBackend,
	DockerCli,
	createSandboxSpec,
} from "../../apps/api/src/sandbox";

class StubChild {
	public readonly stdout = new PassThrough();
	public readonly stderr = new PassThrough();
	public readonly stdin = new PassThrough();
	private readonly exitListeners: Array<(code: number | null) => void> = [];

	constructor(
		private readonly exitCode: number,
		private readonly stdoutChunks: string[],
		private readonly stderrChunks: string[],
		private readonly delayMs = 0,
	) {}

	once(event: "exit", listener: (code: number | null) => void): this;
	once(event: "error", listener: (error: Error) => void): this;
	once(
		event: "exit" | "error",
		listener: ((code: number | null) => void) | ((error: Error) => void),
	): this {
		if (event === "exit") {
			this.exitListeners.push(listener as (code: number | null) => void);
			setTimeout(() => {
				for (const chunk of this.stdoutChunks) {
					this.stdout.write(chunk);
				}
				for (const chunk of this.stderrChunks) {
					this.stderr.write(chunk);
				}
				this.stdout.end();
				this.stderr.end();
				for (const exitListener of this.exitListeners) {
					exitListener(this.exitCode);
				}
			}, this.delayMs);
		}
		return this;
	}

	kill(): boolean {
		for (const exitListener of this.exitListeners) {
			exitListener(137);
		}
		return true;
	}
}

class StubDockerCli extends DockerCli {
	public readonly spawnCalls: string[][] = [];
	public readonly captureCalls: string[][] = [];

	constructor(private readonly child: StubChild) {
		super();
	}

	override spawn(args: string[]) {
		this.spawnCalls.push(args);
		return this.child as unknown as ReturnType<DockerCli["spawn"]>;
	}

	override async capture(args: string[]) {
		this.captureCalls.push(args);
		return {
			exitCode: 0,
			stdout: Buffer.alloc(0),
			stderr: Buffer.alloc(0),
		};
	}
}

function sandboxHandle() {
	return {
		runId: "run-1",
		sandboxId: "sbx-1",
		backend: "docker" as const,
		profile: "std" as const,
		state: "ready" as const,
		approvalState: "not_required" as const,
		spec: createSandboxSpec({
			runId: "run-1",
			sandboxId: "sbx-1",
			profile: "std",
			containerName: "sbx-run-1",
			workVolume: "sbx-run-1-work",
			piHomeHostDir: "/tmp/pi-home",
			piHomePath: "/pi-home",
			inputMountSource: "/tmp/inputs",
			cacheMountSource: "/tmp/cache",
			config: {
				image: "node:24-alpine",
				workdir: "/work",
				defaultTimeoutSec: 900,
				maxBytesOut: 8,
			},
		}),
		previewSpec: {
			imageDigest: "node:24-alpine",
			profile: "std" as const,
			network: "egress" as const,
			containerName: "sbx-run-1",
			workVolume: "sbx-run-1-work",
			workdir: "/work",
			timeoutSec: 900,
			maxBytesOut: 8,
			mounts: [],
		},
		containerName: "sbx-run-1",
		workVolume: "sbx-run-1-work",
		inflightWorkflowId: null,
		leaseExpiresAt: null,
		createdAt: ISO,
		updatedAt: ISO,
		lastSeenAt: ISO,
	};
}

const ISO = "2026-02-28T12:00:00.000Z";

describe("DockerBackend exec", () => {
	it("caps stdout/stderr tails while preserving total byte counts", async () => {
		const child = new StubChild(0, ["1234567890"], ["abcdef"]);
		const dockerCli = new StubDockerCli(child);
		const backend = new DockerBackend({
			dockerCli,
			now: () => new Date(ISO),
		});

		const result = await backend.exec(sandboxHandle(), {
			cmd: ["node", "-e", "console.log('x')"],
			cwd: "/work",
			stream: true,
			timeoutSec: 5,
			maxBytesOut: 4,
			env: { FOO: "bar" },
		});

		expect(result.status).toBe("done");
		expect(result.stdoutBytes).toBe(10);
		expect(result.stderrBytes).toBe(6);
		expect(result.stdoutTail).toBe("7890");
		expect(result.stderrTail).toBe("cdef");
		expect(dockerCli.spawnCalls[0]).toEqual([
			"exec",
			"-i",
			"-w",
			"/work",
			"-e",
			"FOO=bar",
			"sbx-run-1",
			"node",
			"-e",
			"console.log('x')",
		]);
	});

	it("kills timed-out execs and marks them aborted", async () => {
		const child = new StubChild(0, ["still-running"], [], 50);
		const dockerCli = new StubDockerCli(child);
		const backend = new DockerBackend({
			dockerCli,
			now: () => new Date(ISO),
		});

		const result = await backend.exec(sandboxHandle(), {
			cmd: ["sleep", "10"],
			cwd: "/work",
			stream: true,
			timeoutSec: 0,
			maxBytesOut: 64,
		});

		expect(result.status).toBe("aborted");
		expect(dockerCli.captureCalls).toContainEqual(["kill", "sbx-run-1"]);
	});
});
