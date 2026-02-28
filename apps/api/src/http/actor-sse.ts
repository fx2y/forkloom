import type { ActorEvent } from "@forkloom/contracts";
import type { Request, Response } from "express";
import type { ActorEventModel } from "../actor";
import { toActorEventContract } from "../actor";
import { streamBufferedEvents } from "./sse";

export function encodeActorEventFrame(event: ActorEvent): string {
	return `id: ${event.seq}\nevent: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function streamActorEvents(
	req: Request,
	res: Response,
	deps: {
		sinceEventId: number;
		limit: number;
		listEvents(sinceEventId: number, limit: number): Promise<ActorEventModel[]>;
	},
): Promise<void> {
	await streamBufferedEvents(req, res, {
		sinceEventId: deps.sinceEventId,
		limit: deps.limit,
		listEvents: async (sinceEventId, limit) =>
			(await deps.listEvents(sinceEventId, limit)).map(toActorEventContract),
		encodeFrame: (event) => ({
			chunk: encodeActorEventFrame(event),
			deliveredSeq: event.seq,
		}),
	});
}
