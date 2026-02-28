import type { NextFunction, Request, Response } from "express";
import express from "express";
import multer from "multer";
import type { ActorService } from "../actor";
import type { RunService } from "../run/service";
import type { ArtifactService } from "../service";
import { attachActorRoutes } from "./actor-routes";
import {
	parseLinkPayload,
	parseUpload,
	requireRouteParam,
} from "./request-parsers";
import { asyncHandler, mapError } from "./route-utils";
import { attachRunRoutes } from "./run-routes";

const upload = multer({ storage: multer.memoryStorage() });

export function buildApiRouter(deps: {
	artifactService: ArtifactService;
	actorService?: ActorService | undefined;
	runService?: RunService | undefined;
}) {
	const artifactService = deps.artifactService;
	const app = express();

	app.post(
		"/artifacts",
		upload.single("file"),
		asyncHandler(async (req, res) => {
			const uploadInput = await parseUpload(req);
			const artifact = await artifactService.putArtifact(uploadInput);
			res.json(artifact);
		}),
	);

	app.get(
		"/artifacts/:sha256",
		asyncHandler(async (req, res) => {
			const result = await artifactService.getArtifactBytes(
				requireRouteParam(req.params.sha256, "sha256"),
			);
			res.setHeader(
				"content-type",
				result.contentType ?? "application/octet-stream",
			);
			result.body.pipe(res);
		}),
	);

	app.get(
		"/artifacts/:sha256/meta",
		asyncHandler(async (req, res) => {
			const artifact = await artifactService.getArtifactMeta(
				requireRouteParam(req.params.sha256, "sha256"),
			);
			res.json(artifact);
		}),
	);

	app.post(
		"/artifacts/:sha256/link",
		express.json({ limit: "1mb" }),
		asyncHandler(async (req, res) => {
			const payload = parseLinkPayload(req.body);
			const artifact = await artifactService.linkArtifact(
				requireRouteParam(req.params.sha256, "sha256"),
				payload.parent,
				payload.meta,
			);
			res.json(artifact);
		}),
	);

	if (deps.runService) {
		attachRunRoutes(app, deps.runService);
	}

	if (deps.actorService) {
		attachActorRoutes(app, deps.actorService);
	}

	app.use(
		(error: unknown, _req: Request, res: Response, _next: NextFunction) => {
			const mapped = mapError(error);
			res.status(mapped.status).json({ error: mapped.message });
		},
	);

	return app;
}
