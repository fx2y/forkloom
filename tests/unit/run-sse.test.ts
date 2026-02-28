import { describe, expect, it } from "vitest";
import { encodeRunEventFrame } from "../../apps/api/src/http/sse";
import { BufferedSseStream } from "../../apps/api/src/http/sse-buffer";

class StubWritable {
	public readonly chunks: string[] = [];
	public ended = false;
	private readonly drainListeners: Array<() => void> = [];
	private readonly backpressure = new Set<number>();

	constructor(backpressureAt: number[] = []) {
		for (const index of backpressureAt) {
			this.backpressure.add(index);
		}
	}

	write(chunk: string): boolean {
		this.chunks.push(chunk);
		return !this.backpressure.has(this.chunks.length);
	}

	once(_event: "drain", listener: () => void): void {
		this.drainListeners.push(listener);
	}

	end(): void {
		this.ended = true;
	}

	emitDrain(): void {
		const listeners = this.drainListeners.splice(0);
		for (const listener of listeners) {
			listener();
		}
	}
}

describe("run SSE helpers", () => {
	it("encodes run events as SSE frames", () => {
		const frame = encodeRunEventFrame({
			runId: "01HS7Z6E5R4W6NED8MH4D9Y6A0",
			seq: 4,
			t: "2026-02-27T00:00:00.000Z",
			kind: "pi_event",
			payload: { chunk: "ok" },
		});

		expect(frame).toContain("id: 4");
		expect(frame).toContain("event: pi_event");
		expect(frame).toContain('"chunk":"ok"');
	});

	it("emits a gap control frame and closes on overflow", async () => {
		const writable = new StubWritable([1]);
		const stream = new BufferedSseStream(writable, 1, 0);

		expect(
			stream.enqueueFrame({
				chunk: 'id: 1\nevent: run_started\ndata: {"seq":1}\n\n',
				deliveredSeq: 1,
			}),
		).toBe(true);
		expect(
			stream.enqueueFrame({
				chunk: 'id: 2\nevent: pi_event\ndata: {"seq":2}\n\n',
				deliveredSeq: 2,
			}),
		).toBe(true);
		expect(
			stream.enqueueFrame({
				chunk: 'id: 3\nevent: run_done\ndata: {"seq":3}\n\n',
				deliveredSeq: 3,
			}),
		).toBe(false);

		writable.emitDrain();
		await Promise.resolve();
		await Promise.resolve();

		expect(writable.chunks[0]).toContain("event: run_started");
		expect(writable.chunks[1]).toContain("event: gap");
		expect(writable.chunks[1]).toContain('"reconnectFrom":0');
		expect(writable.ended).toBe(true);
		expect(stream.lastDeliveredSeq).toBe(1);
	});
});
