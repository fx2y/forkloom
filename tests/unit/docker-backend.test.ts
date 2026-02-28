import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	DockerBackend,
	DockerCli,
	createSandboxSpec,
} from "../../apps/api/src/sandbox";

class StubDockerCli extends DockerCli {
	public readonly captureCalls: string[][] = [];
	private readonly queue: Array<{
		exitCode: number;
		stdout?: string;
		stderr?: string;
	}>;

	constructor(
		queue: Array<{ exitCode: number; stdout?: string; stderr?: string }>,
	) {
		super();
		this.queue = [...queue];
	}

	override async capture(args: string[]) {
		this.captureCalls.push(args);
		const next = this.queue.shift() ?? { exitCode: 0 };
		return {
			exitCode: next.exitCode,
			stdout: Buffer.from(next.stdout ?? "", "utf8"),
			stderr: Buffer.from(next.stderr ?? "", "utf8"),
		};
	}
}

describe("DockerBackend lifecycle", () => {
	it("creates missing volumes and containers via argv-only docker calls", async () => {
		const tempRoot = await mkdtemp(join(tmpdir(), "forkloom-sbx-"));
		const dockerCli = new StubDockerCli([
			{ exitCode: 1 },
			{ exitCode: 0 },
			{ exitCode: 1 },
			{ exitCode: 0 },
		]);
		const backend = new DockerBackend({ dockerCli });
		try {
			const spec = createSandboxSpec({
				runId: "run-1",
				sandboxId: "sbx-1",
				profile: "safe",
				containerName: "sbx-run-1",
				workVolume: "sbx-run-1-work",
				piHomeHostDir: join(tempRoot, "pi-home"),
				piHomePath: "/pi-home",
				inputMountSource: join(tempRoot, "inputs"),
				cacheMountSource: join(tempRoot, "cache"),
				config: {
					image: "node:24-alpine",
					workdir: "/work",
					defaultTimeoutSec: 900,
					maxBytesOut: 256_000,
				},
			});

			const sandbox = await backend.ensureSandbox(spec);

			expect(sandbox.state).toBe("ready");
			expect(dockerCli.captureCalls).toEqual([
				["volume", "inspect", "sbx-run-1-work"],
				["volume", "create", "sbx-run-1-work"],
				["inspect", "sbx-run-1"],
				expect.arrayContaining([
					"run",
					"-d",
					"--name",
					"sbx-run-1",
					"--network",
					"none",
					"node:24-alpine",
				]),
			]);
		} finally {
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("sleeps and recreates a sandbox while keeping the named work volume", async () => {
		const dockerCli = new StubDockerCli([
			{ exitCode: 0, stdout: '[{"State":{"Running":true}}]' },
			{ exitCode: 0 },
			{ exitCode: 0 },
			{ exitCode: 0 },
		]);
		const backend = new DockerBackend({ dockerCli, now: () => new Date(ISO) });
		const sandbox = {
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
					maxBytesOut: 256_000,
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
				maxBytesOut: 256_000,
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

		const sleeping = await backend.sleepSandbox(sandbox);
		const recreated = await backend.recreateSandbox(sleeping);

		expect(sleeping.state).toBe("sleeping");
		expect(recreated.state).toBe("ready");
		expect(dockerCli.captureCalls[0]).toEqual(["stop", "-t", "1", "sbx-run-1"]);
		expect(dockerCli.captureCalls[1]).toEqual(["rm", "-f", "sbx-run-1"]);
		expect(dockerCli.captureCalls[2]?.join(" ")).toContain("sbx-run-1-work");
	});
});

const ISO = "2026-02-28T12:00:00.000Z";
