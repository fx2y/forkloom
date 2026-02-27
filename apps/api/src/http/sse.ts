import type { RunEvent } from "@forkloom/contracts";
import type { Request, Response } from "express";
import { isTerminalRunEventKind } from "../run";

const POLL_MS = 250;
export const MAX_BUFFER = 100;

type WritableLike = {
	write(chunk: string): boolean;
	end(): void;
	once(event: "drain", listener: () => void): void;
};

type PendingFrame = {
	chunk: string;
	deliveredSeq?: number | undefined;
};

export class BufferedSseStream {
	private readonly pending: PendingFrame[] = [];
	private flushing = false;
	private closeAfterFlush = false;
	private overflowed = false;
	private deliveredSeq: number;

	constructor(
		private readonly writable: WritableLike,
		private readonly maxBuffer: number,
		initialSeq: number,
	) {
		this.deliveredSeq = initialSeq;
	}

	get lastDeliveredSeq(): number {
		return this.deliveredSeq;
	}

	get isOverflowed(): boolean {
		return this.overflowed;
	}

	writeComment(comment: string): void {
		this.pending.push({ chunk: `:${comment}\n\n` });
		void this.flush();
	}

	enqueueEvent(event: RunEvent): boolean {
		if (this.closeAfterFlush) {
			return false;
		}
		if (this.pending.length >= this.maxBuffer) {
			this.overflowed = true;
			this.pending.length = 0;
			this.pending.push({
				chunk: encodeControlFrame("gap", {
					reason: "overflow",
					reconnectFrom: this.deliveredSeq,
				}),
			});
			this.closeAfterFlush = true;
			void this.flush();
			return false;
		}
		this.pending.push({
			chunk: encodeRunEventFrame(event),
			deliveredSeq: event.seq,
		});
		void this.flush();
		return true;
	}

	close(): void {
		this.closeAfterFlush = true;
		if (!this.flushing && this.pending.length === 0) {
			this.writable.end();
			return;
		}
		void this.flush();
	}

	private async flush(): Promise<void> {
		if (this.flushing) {
			return;
		}
		this.flushing = true;
		try {
			while (this.pending.length > 0) {
				const frame = this.pending.shift();
				if (!frame) {
					continue;
				}
				const accepted = this.writable.write(frame.chunk);
				if (!accepted) {
					await waitForDrain(this.writable);
				}
				if (frame.deliveredSeq != null) {
					this.deliveredSeq = frame.deliveredSeq;
				}
			}
			if (this.closeAfterFlush) {
				this.writable.end();
			}
		} finally {
			this.flushing = false;
			if (this.pending.length > 0) {
				void this.flush();
			}
		}
	}
}

function waitForDrain(writable: WritableLike): Promise<void> {
	return new Promise((resolve) => {
		writable.once("drain", resolve);
	});
}

export function encodeRunEventFrame(event: RunEvent): string {
	return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function encodeControlFrame(
	event: string,
	payload: Record<string, unknown>,
): string {
	return `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
}

export async function streamRunEvents(
	req: Request,
	res: Response,
	deps: {
		sinceEventId: number;
		limit: number;
		listEvents(sinceEventId: number, limit: number): Promise<RunEvent[]>;
	},
): Promise<void> {
	res.status(200);
	res.setHeader("content-type", "text/event-stream");
	res.setHeader("cache-control", "no-cache");
	res.setHeader("connection", "keep-alive");
	res.flushHeaders();

	let closed = false;
	let polling = false;
	let cursor = deps.sinceEventId;
	const stream = new BufferedSseStream(res, MAX_BUFFER, cursor);
	stream.writeComment("ok");

	const stop = () => {
		closed = true;
		clearInterval(timer);
		stream.close();
	};

	req.on("close", stop);

	const poll = async () => {
		if (closed || polling || stream.isOverflowed) {
			return;
		}
		polling = true;
		try {
			const events = await deps.listEvents(cursor, deps.limit);
			for (const event of events) {
				cursor = event.seq;
				if (!stream.enqueueEvent(event)) {
					clearInterval(timer);
					return;
				}
				if (isTerminalRunEventKind(event.kind)) {
					closed = true;
					clearInterval(timer);
					stream.close();
					return;
				}
			}
		} finally {
			polling = false;
		}
	};

	const timer = setInterval(() => {
		void poll();
	}, POLL_MS);

	await poll();
}
