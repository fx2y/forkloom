import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it } from "vitest";
import {
	DockerCli,
	buildSandboxPiRpcArgs,
	createSandboxPiSessionFactory,
} from "../../apps/api/src/sandbox";

class RpcChild {
	public readonly stdin = new PassThrough();
	public readonly stdout = new PassThrough();
	public readonly stderr = new PassThrough();

	constructor(private readonly shouldReply: boolean) {
		let buffer = "";
		this.stdin.on("data", (chunk) => {
			buffer += chunk.toString("utf8");
			for (;;) {
				const newline = buffer.indexOf("\n");
				if (newline < 0) {
					break;
				}
				const line = buffer.slice(0, newline);
				buffer = buffer.slice(newline + 1);
				if (!this.shouldReply || line.trim().length === 0) {
					continue;
				}
				const parsed = JSON.parse(line) as { id?: string; type?: string };
				if (parsed.type === "get_state") {
					this.stdout.write(
						`${JSON.stringify({
							type: "response",
							id: parsed.id,
							success: true,
							data: {
								sessionFile: "/pi-home/.pi/agent/sessions/mock.jsonl",
								sessionId: "session-1",
								isStreaming: false,
								pending: 0,
							},
						})}\n`,
					);
					continue;
				}
				this.stdout.write(
					`${JSON.stringify({
						type: "response",
						id: parsed.id,
						success: true,
						data: {},
					})}\n`,
				);
			}
		});
	}

	kill(): boolean {
		return true;
	}

	once(
		event: "exit",
		listener: (code: number | null, signal: NodeJS.Signals | null) => void,
	): void {
		if (event === "exit") {
			this.stdin.once("close", () => listener(0, null));
		}
	}
}

class StubDockerCli extends DockerCli {
	public readonly spawnCalls: string[][] = [];
	private readonly replies: boolean[];

	constructor(replies: boolean[]) {
		super();
		this.replies = [...replies];
	}

	override spawn(args: string[]) {
		this.spawnCalls.push(args);
		return new RpcChild(this.replies.shift() ?? true) as never;
	}
}

const tempDirs: string[] = [];

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			await rm(dir, { recursive: true, force: true });
		}
	}
});

async function prepareSourceHome(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "forkloom-pi-home-"));
	tempDirs.push(dir);
	await mkdir(join(dir, ".pi", "agent"), { recursive: true });
	await writeFile(join(dir, ".pi", "agent", "auth.json"), "{}", "utf8");
	await writeFile(join(dir, ".pi", "agent", "settings.json"), "{}", "utf8");
	await writeFile(join(dir, ".pi", "agent", "models.json"), "{}", "utf8");
	return dir;
}

describe("sandbox pi session factory", () => {
	it("builds docker exec argv for in-sandbox pi rpc", () => {
		expect(
			buildSandboxPiRpcArgs({
				containerName: "sbx-run-1",
				cwd: "/work",
				homePath: "/pi-home",
				provider: "github-copilot",
				model: "gpt-4.1",
				sessionPath: "/pi-home/session.jsonl",
			}),
		).toEqual([
			"exec",
			"-i",
			"-w",
			"/work",
			"-e",
			"HOME=/pi-home",
			"sbx-run-1",
			"pi",
			"--mode",
			"rpc",
			"--provider",
			"github-copilot",
			"--model",
			"gpt-4.1",
			"--session",
			"/pi-home/session.jsonl",
		]);
	});

	it("falls back to the mock provider when strict-real bootstrap fails", async () => {
		const realHome = await prepareSourceHome();
		const sandboxHome = await mkdtemp(join(tmpdir(), "forkloom-sbx-home-"));
		tempDirs.push(sandboxHome);
		const dockerCli = new StubDockerCli([false, true]);
		const factory = createSandboxPiSessionFactory(
			{
				containerName: "sbx-run-1",
				cwd: "/work",
				homeHostDir: sandboxHome,
				homePath: "/pi-home",
				provider: "github-copilot",
				model: "gpt-4.1",
			},
			{
				dockerCli,
				sourceHome: realHome,
				mockProviderManager: {
					acquire: async () => ({
						provider: "mock-provider",
						model: "mock-model",
						homeOverride: realHome,
						release: async () => undefined,
					}),
				} as never,
			},
		);

		const session = await factory({ bootstrapTimeoutMs: 10 });
		const state = await session.getState();

		expect(state.sessionId).toBe("session-1");
		expect(dockerCli.spawnCalls).toHaveLength(2);
		expect(dockerCli.spawnCalls[0]).toContain("github-copilot");
		expect(dockerCli.spawnCalls[1]).toContain("mock-provider");
		await session.close();
	});
});
