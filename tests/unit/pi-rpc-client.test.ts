import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { PiRpcClient } from "../../apps/api/src/pi/rpc-client";

class FakePiProcess extends EventEmitter {
	public readonly stdin = new PassThrough();
	public readonly stdout = new PassThrough();
	public readonly stderr = new PassThrough();

	kill(): boolean {
		this.emit("exit", 0, null);
		return true;
	}
}

describe("PiRpcClient", () => {
	it("writes jsonl commands and waits for response by id", async () => {
		const process = new FakePiProcess();
		const client = new PiRpcClient({ process, responseTimeoutMs: 1_000 });

		const written: string[] = [];
		process.stdin.on("data", (chunk) => {
			written.push(chunk.toString("utf8"));
		});

		client.send({ id: "st-1", type: "get_state" });
		process.stdout.write(
			`${JSON.stringify({ type: "response", id: "st-1", success: true, data: { sessionFile: "/tmp/s", sessionId: "sid", isStreaming: false, pending: 0 } })}\n`,
		);

		const response = await client.waitResponse("st-1");
		expect(written.join("")).toContain('"type":"get_state"');
		expect(response.success).toBe(true);
		await client.close();
	});

	it("captures non-response json events for later draining", async () => {
		const process = new FakePiProcess();
		const client = new PiRpcClient({ process, responseTimeoutMs: 1_000 });

		process.stdout.write(
			`${JSON.stringify({ type: "agent_event", data: { chunk: "x" } })}\n`,
		);

		const events = client.drainEvents();
		expect(events).toEqual([{ type: "agent_event", data: { chunk: "x" } }]);
		await client.close();
	});
});
