import type { Request, Response } from "express";
import { BufferedSseStream, encodeControlFrame } from "./sse-buffer";

const POLL_MS = 250;
export const MAX_BUFFER = 100;

export async function streamBufferedEvents<TEvent extends { seq: number }>(
	req: Request,
	res: Response,
	deps: {
		sinceEventId: number;
		limit: number;
		listEvents(sinceEventId: number, limit: number): Promise<TEvent[]>;
		encodeFrame(event: TEvent): {
			chunk: string;
			deliveredSeq: number;
		};
		shouldClose?: ((event: TEvent) => boolean) | undefined;
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

	const closeWithPollError = () => {
		if (closed) {
			return;
		}
		closed = true;
		clearInterval(timer);
		stream.enqueueFrame({
			chunk: encodeControlFrame("gap", {
				reason: "poll_error",
				reconnectFrom: stream.lastDeliveredSeq,
			}),
		});
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
				if (!stream.enqueueFrame(deps.encodeFrame(event))) {
					clearInterval(timer);
					return;
				}
				if (deps.shouldClose?.(event) === true) {
					closed = true;
					clearInterval(timer);
					stream.close();
					return;
				}
			}
		} catch {
			closeWithPollError();
		} finally {
			polling = false;
		}
	};

	const timer = setInterval(() => {
		void poll();
	}, POLL_MS);

	await poll();
}
