import { describe, expect, it } from "vitest";
import { encodeActorEventFrame } from "../../apps/api/src/http/actor-sse";
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

describe("actor SSE helpers", () => {
	it("encodes actor events as SSE frames", () => {
		const frame = encodeActorEventFrame({
			actorId: "actor-1",
			seq: 4,
			t: "2026-02-28T00:00:00.000Z",
			kind: "mailbox_processed",
			payload: { seq: 4 },
		});

		expect(frame).toContain("id: 4");
		expect(frame).toContain("event: mailbox_processed");
		expect(frame).toContain('"seq":4');
	});

	it("reuses the generic buffered gap semantics", async () => {
		const writable = new StubWritable([1]);
		const stream = new BufferedSseStream(writable, 1, 0);

		expect(
			stream.enqueueFrame({
				chunk:
					'id: 1\nevent: mailbox_queued\ndata: {"actorId":"actor-1","seq":1}\n\n',
				deliveredSeq: 1,
			}),
		).toBe(true);
		expect(
			stream.enqueueFrame({
				chunk:
					'id: 2\nevent: mailbox_processed\ndata: {"actorId":"actor-1","seq":2}\n\n',
				deliveredSeq: 2,
			}),
		).toBe(true);
		expect(
			stream.enqueueFrame({
				chunk:
					'id: 3\nevent: pi_event\ndata: {"actorId":"actor-1","seq":3}\n\n',
				deliveredSeq: 3,
			}),
		).toBe(false);

		writable.emitDrain();
		await Promise.resolve();
		await Promise.resolve();

		expect(writable.chunks[0]).toContain("event: mailbox_queued");
		expect(writable.chunks[1]).toContain("event: gap");
		expect(writable.chunks[1]).toContain('"reconnectFrom":0');
		expect(writable.ended).toBe(true);
	});
});
