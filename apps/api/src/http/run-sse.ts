import type { RunEvent } from "@forkloom/contracts";
import type { Request, Response } from "express";
import { streamBufferedEvents } from "./sse";

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
	await streamBufferedEvents(req, res, {
		sinceEventId: deps.sinceEventId,
		limit: deps.limit,
		listEvents: deps.listEvents,
		encodeFrame: (event) => ({
			chunk: encodeRunEventFrame(event),
			deliveredSeq: event.seq,
		}),
	});
}
