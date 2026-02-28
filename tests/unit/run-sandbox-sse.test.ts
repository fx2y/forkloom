import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { streamInteractiveRunEvents } from "../../apps/api/src/http/run-sandbox-sse";

class StubRequest extends EventEmitter {}

class StubResponse {
	public readonly chunks: string[] = [];
	public readonly headers = new Map<string, string>();
	public ended = false;
	public statusCode = 200;

	status(code: number): this {
		this.statusCode = code;
		return this;
	}

	setHeader(name: string, value: string): void {
		this.headers.set(name.toLowerCase(), value);
	}

	flushHeaders(): void {
		return;
	}

	write(chunk: string): boolean {
		this.chunks.push(chunk);
		return true;
	}

	once(_event: "drain", _listener: () => void): this {
		return this;
	}

	end(): void {
		this.ended = true;
	}
}

describe("run sandbox SSE", () => {
	it("keeps interactive streams open after terminal frames until the client disconnects", async () => {
		const req = new StubRequest();
		const res = new StubResponse();
		let polls = 0;

		await streamInteractiveRunEvents(req as never, res as never, {
			sinceEventId: 0,
			limit: 10,
			listEvents: async () => {
				polls += 1;
				if (polls > 1) {
					return [];
				}
				return [
					{
						runId: "01HS7Z6E5R4W6NED8MH4D9Y6A0",
						seq: 1,
						t: "2026-02-28T00:00:00.000Z",
						kind: "run_aborted",
						payload: { seq: 1 },
					},
				];
			},
		});

		expect(res.statusCode).toBe(200);
		expect(res.headers.get("content-type")).toBe("text/event-stream");
		expect(
			res.chunks.some((chunk) => chunk.includes("event: run_aborted")),
		).toBe(true);
		expect(res.ended).toBe(false);

		req.emit("close");
		expect(res.ended).toBe(true);
	});
});
