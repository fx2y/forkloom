import { describe, expect, it } from "vitest";
import {
	type PiPromptInput,
	RpcPiSessionPort,
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
});
