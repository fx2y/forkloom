import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	type PiPromptInput,
	RpcPiSessionPort,
	waitForPiIdle,
} from "../../apps/api/src/pi/session-port";

type CommandEnvelope = {
	id?: string;
	type: string;
	streamingBehavior?: string;
	message?: string;
};

class StubRpcClient {
	public readonly sent: CommandEnvelope[] = [];
	private readonly stateIsStreaming: boolean;

	constructor(stateIsStreaming: boolean) {
		this.stateIsStreaming = stateIsStreaming;
	}

	send(payload: Record<string, unknown>): void {
		this.sent.push(payload as CommandEnvelope);
	}

	async waitResponse(id: string): Promise<{
		type: "response";
		id: string;
		success: boolean;
		data: Record<string, unknown>;
	}> {
		const request = this.sent.find((item) => item.id === id);
		if (!request) {
			throw new Error("missing request");
		}
		if (request.type === "get_state") {
			return {
				type: "response",
				id,
				success: true,
				data: {
					sessionFile: "/tmp/pi.session.jsonl",
					sessionId: "sess-1",
					isStreaming: this.stateIsStreaming,
					pending: this.stateIsStreaming ? 1 : 0,
				},
			};
		}
		if (request.type === "get_last_assistant_text") {
			return {
				type: "response",
				id,
				success: true,
				data: {
					text: "",
				},
			};
		}
		return { type: "response", id, success: true, data: {} };
	}

	drainEvents(): Record<string, unknown>[] {
		return [];
	}

	async close(): Promise<void> {
		return;
	}
}

async function callPrompt(
	stateIsStreaming: boolean,
	input: PiPromptInput,
): Promise<CommandEnvelope[]> {
	const rpc = new StubRpcClient(stateIsStreaming);
	const session = new RpcPiSessionPort(rpc);
	await session.prompt(input);
	return rpc.sent;
}

describe("RpcPiSessionPort streaming behavior", () => {
	it("rejects prompt without streamingBehavior while stream is active", async () => {
		const rpc = new StubRpcClient(true);
		const session = new RpcPiSessionPort(rpc);
		await expect(
			session.prompt({
				message: "interrupt",
			}),
		).rejects.toThrow("streamingBehavior");
	});

	it("sends prompt with behavior when stream is active", async () => {
		const sent = await callPrompt(true, {
			message: "interrupt",
			streamingBehavior: "steer",
		});
		const promptCall = sent.find((item) => item.type === "prompt");
		expect(promptCall?.streamingBehavior).toBe("steer");
	});

	it("configures one-at-a-time queue modes through RPC commands", async () => {
		const rpc = new StubRpcClient(false);
		const session = new RpcPiSessionPort(rpc);

		await session.setQueueMode({
			followUpMode: "one-at-a-time",
			steeringMode: "one-at-a-time",
		});

		expect(rpc.sent.map((item) => item.type)).toContain("set_follow_up_mode");
		expect(rpc.sent.map((item) => item.type)).toContain("set_steering_mode");
	});

	it("allows blank assistant text responses from the RPC adapter", async () => {
		const rpc = new StubRpcClient(false);
		const session = new RpcPiSessionPort(rpc);

		await expect(session.getLastAssistantText()).resolves.toBe("");
	});

	it("materializes a minimal session header when the reported session file is missing", async () => {
		const sessionFile = join(
			tmpdir(),
			`forkloom-pi-session-${Date.now()}`,
			"session.jsonl",
		);
		const sessionDir = dirname(sessionFile);
		rmSync(sessionFile, { force: true });
		rmSync(sessionDir, { recursive: true, force: true });

		const rpc = new StubRpcClient(false);
		rpc.waitResponse = async (id: string) => {
			const request = rpc.sent.find((item) => item.id === id);
			if (!request) {
				throw new Error("missing request");
			}
			if (request.type === "get_state") {
				return {
					type: "response" as const,
					id,
					success: true,
					data: {
						sessionFile,
						sessionId: "sess-1",
						isStreaming: false,
						pending: 0,
					},
				};
			}
			return { type: "response" as const, id, success: true, data: {} };
		};
		const session = new RpcPiSessionPort(rpc);

		const state = await session.getState();

		expect(state.sessionFile).toBe(sessionFile);
		expect(existsSync(sessionFile)).toBe(true);
		expect(readFileSync(sessionFile, "utf8")).toContain('"type":"session"');
		rmSync(sessionDir, { recursive: true, force: true });
	});

	it("waitForPiIdle does not return on transient initial idle state", async () => {
		let stateIndex = 0;
		const states = [
			{ isStreaming: false, pending: 0 },
			{ isStreaming: true, pending: 1 },
			{ isStreaming: false, pending: 0 },
			{ isStreaming: false, pending: 0 },
		] as const;

		await waitForPiIdle({
			drainEvents: () => [],
			getState: async () => {
				const fallback = states.at(-1);
				if (!fallback) {
					throw new Error("missing fallback state");
				}
				const current = states[stateIndex] ?? fallback;
				stateIndex += 1;
				return current;
			},
			pollMs: 1,
			timeoutMs: 500,
			minWaitMs: 0,
			idleGraceMs: 2,
		});

		expect(stateIndex).toBeGreaterThanOrEqual(3);
	});
});
