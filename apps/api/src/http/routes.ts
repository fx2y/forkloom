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
import {
	parseRunCommandPayload,
	parseRunCreatePayload,
	parseRunCursor,
	parseRunFileExportPayload,
} from "./run-request-parsers";
import { streamRunEvents } from "./run-sse";

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
		const runService = deps.runService;
		app.post(
			"/runs",
			express.json({ limit: "1mb" }),
			asyncHandler(async (req, res) => {
				const spec = parseRunCreatePayload(req.body);
				const started = await runService.startRun(spec);
				res.status(started.created ? 201 : 200).json({
					runId: started.run.runId,
					created: started.created,
					status: started.run.status,
					preview:
						started.sandbox == null
							? undefined
							: {
									imageDigest: started.sandbox.previewSpec.imageDigest,
									profile: started.sandbox.previewSpec.profile,
									network: started.sandbox.previewSpec.network,
									workdir: started.sandbox.previewSpec.workdir,
									timeoutSec: started.sandbox.previewSpec.timeoutSec,
									maxBytesOut: started.sandbox.previewSpec.maxBytesOut,
							  },
					approval:
						started.sandbox == null
							? undefined
							: {
									required:
										started.sandbox.approvalState !== "not_required",
									state: started.sandbox.approvalState,
							  },
					command:
						started.command == null
							? undefined
							: {
									seq: started.command.seq,
									kind: started.command.kind,
									state: started.command.state,
							  },
				});
			}),
		);

		app.get(
			"/runs/:runId",
			asyncHandler(async (req, res) => {
				const runId = requireRouteParam(req.params.runId, "runId");
				const run = await runService.getRunState(runId);
				if (!run) {
					res.status(404).json({ error: "run not found" });
					return;
				}
				res.json(run);
			}),
		);

		app.get(
			"/runs/:runId/events",
			asyncHandler(async (req, res) => {
				const runId = requireRouteParam(req.params.runId, "runId");
				const run = await runService.getRunState(runId);
				if (!run) {
					res.status(404).json({ error: "run not found" });
					return;
				}
				const cursor = parseRunCursor(req);
				await streamRunEvents(req, res, {
					sinceEventId: cursor.sinceEventId,
					limit: cursor.limit,
					listEvents: (sinceEventId, limit) =>
						runService.listRunEvents(runId, sinceEventId, limit),
				});
			}),
		);

		app.post(
			"/runs/:runId/commands",
			express.json({ limit: "1mb" }),
			asyncHandler(async (req, res) => {
				const runId = requireRouteParam(req.params.runId, "runId");
				const command = parseRunCommandPayload(req.body);
				const queued = await runService.queueCommand({
					runId,
					kind: command.kind,
					payload: command.payload,
					dedupeKey: command.dedupeKey,
				});
				res.status(queued.created ? 202 : 200).json({
					created: queued.created,
					command: {
						seq: queued.command.seq,
						kind: queued.command.kind,
						state: queued.command.state,
					},
				});
			}),
		);

		app.get(
			"/runs/:runId/files",
			asyncHandler(async (req, res) => {
				const runId = requireRouteParam(req.params.runId, "runId");
				res.json(await runService.listFiles(runId));
			}),
		);

		app.post(
			"/runs/:runId/files/export",
			express.json({ limit: "1mb" }),
			asyncHandler(async (req, res) => {
				const runId = requireRouteParam(req.params.runId, "runId");
				const payload = parseRunFileExportPayload(req.body);
				res.status(202).json(
					await runService.exportFiles({
						runId,
						paths: payload.paths,
					}),
				);
			}),
		);
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
