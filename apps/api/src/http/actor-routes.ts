import type { Express } from "express";
import express from "express";
import {
	type ActorService,
	toActorEventContract,
	toActorStateContract,
} from "../actor";
import {
	parseActorCreatePayload,
	parseActorCursor,
	parseMailboxPostPayload,
} from "./actor-request-parsers";
import { streamActorEvents } from "./actor-sse";
import { requireRouteParam } from "./request-parsers";
import { asyncHandler } from "./route-utils";

export function attachActorRoutes(
	app: Express,
	actorService: ActorService,
): void {
	app.post(
		"/actors",
		express.json({ limit: "1mb" }),
		asyncHandler(async (req, res) => {
			const actor = await actorService.createActor(
				parseActorCreatePayload(req.body),
			);
			res.status(201).json(toActorStateContract(actor));
		}),
	);

	app.get(
		"/actors",
		asyncHandler(async (_req, res) => {
			const actors = await actorService.listActors();
			res.json(actors.map(toActorStateContract));
		}),
	);

	app.get(
		"/actors/:actorId",
		asyncHandler(async (req, res) => {
			const actorId = requireRouteParam(req.params.actorId, "actorId");
			const actor = await actorService.getActorState(actorId);
			if (!actor) {
				res.status(404).json({ error: "actor not found" });
				return;
			}
			res.json(toActorStateContract(actor));
		}),
	);

	app.post(
		"/actors/:actorId/messages",
		express.json({ limit: "1mb" }),
		asyncHandler(async (req, res) => {
			const actorId = requireRouteParam(req.params.actorId, "actorId");
			const event = await actorService.sendMessage({
				actorId,
				...parseMailboxPostPayload(req.body),
			});
			res.status(201).json(toActorEventContract(event));
		}),
	);

	app.get(
		"/actors/:actorId/events",
		asyncHandler(async (req, res) => {
			const actorId = requireRouteParam(req.params.actorId, "actorId");
			const actor = await actorService.getActorState(actorId);
			if (!actor) {
				res.status(404).json({ error: "actor not found" });
				return;
			}
			const cursor = parseActorCursor(req);
			await streamActorEvents(req, res, {
				sinceEventId: cursor.sinceEventId,
				limit: cursor.limit,
				listEvents: (sinceEventId, limit) =>
					actorService.listActorEvents(actorId, sinceEventId, limit),
			});
		}),
	);
}
