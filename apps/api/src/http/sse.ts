import type { RunEvent } from "@forkloom/contracts";
import type { Request, Response } from "express";
import { isTerminalRunEventKind } from "../run";
import { BufferedSseStream } from "./sse-buffer";

const POLL_MS = 250;
export const MAX_BUFFER = 100;

export function encodeRunEventFrame(event: RunEvent): string {
	return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
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
				if (
					!stream.enqueueFrame({
						chunk: encodeRunEventFrame(event),
						deliveredSeq: event.seq,
					})
				) {
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
