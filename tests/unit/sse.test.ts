import { describe, expect, it } from "vitest";
import { streamBufferedEvents } from "../../apps/api/src/http/sse";

class StubResponse {
	public readonly headers = new Map<string, string>();
	public readonly chunks: string[] = [];
	public ended = false;

	status(_code: number) {
		return this;
	}

	setHeader(name: string, value: string): void {
		this.headers.set(name, value);
	}

	flushHeaders(): void {
		return;
	}

	write(chunk: string): boolean {
		this.chunks.push(chunk);
		return true;
	}

	once(_event: "drain", _listener: () => void): void {
		return;
	}

	end(): void {
		this.ended = true;
	}
}

class StubRequest {
	on(_event: "close", _listener: () => void): void {
		return;
	}
}

describe("streamBufferedEvents", () => {
	it("emits a reconnectable gap frame when poll logic fails after headers flush", async () => {
		const req = new StubRequest();
		const res = new StubResponse();

		await streamBufferedEvents(req as never, res as never, {
			sinceEventId: 5,
			limit: 10,
			listEvents: async () => {
				throw new Error("boom");
			},
			encodeFrame: (event: { seq: number }) => ({
				chunk: `id: ${event.seq}\nevent: test\ndata: {}\n\n`,
				deliveredSeq: event.seq,
			}),
		});

		expect(res.chunks.join("")).toContain("event: gap");
		expect(res.chunks.join("")).toContain('"reason":"poll_error"');
		expect(res.chunks.join("")).toContain('"reconnectFrom":5');
		expect(res.ended).toBe(true);
	});
});
