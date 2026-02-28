import type { Express } from "express";
import express from "express";
import type { RunService } from "../run/service";
import { requireRouteParam } from "./request-parsers";
import { asyncHandler } from "./route-utils";
import {
	parseRunCommandPayload,
	parseRunCreatePayload,
	parseRunCursor,
	parseRunFileExportPayload,
} from "./run-request-parsers";
import { streamInteractiveRunEvents } from "./run-sandbox-sse";
import { streamRunEvents } from "./run-sse";

function isInteractiveRunState(run: Record<string, unknown>): boolean {
	return (
		run.preview != null ||
		run.approval != null ||
		run.currentCommand != null ||
		run.files != null
	);
}

export function attachRunRoutes(app: Express, runService: RunService): void {
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
								required: started.sandbox.approvalState !== "not_required",
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
			const stream = isInteractiveRunState(run)
				? streamInteractiveRunEvents
				: streamRunEvents;
			await stream(req, res, {
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
