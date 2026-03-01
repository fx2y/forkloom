import type { Express } from "express";
import express from "express";
import type { RunService } from "../run/service";
import { requireRouteParam } from "./request-parsers";
import { asyncHandler } from "./route-utils";
import {
	parseRunDocIngestPayload,
	parseRunDocResolvePayload,
	parseRunDocSearchPayload,
} from "./run-request-parsers";

export function attachRunDocRoutes(
	app: Express,
	runService: RunService,
): void {
	app.post(
		"/runs/:runId/doc/ingest",
		express.json({ limit: "80mb" }),
		asyncHandler(async (req, res) => {
			const runId = requireRouteParam(req.params.runId, "runId");
			const payload = parseRunDocIngestPayload(req.body);
			const ingested = await runService.ingestDoc({
				runId,
				mime: payload.mime,
				body: payload.body,
			});
			res.status(ingested.status === "queued" ? 202 : 200).json(ingested);
		}),
	);

	app.post(
		"/runs/:runId/doc/search",
		express.json({ limit: "1mb" }),
		asyncHandler(async (req, res) => {
			const runId = requireRouteParam(req.params.runId, "runId");
			const payload = parseRunDocSearchPayload(req.body);
			res.json(
				await runService.searchDocs({
					runId,
					query: payload.query,
					scope: payload.scope,
					limit: payload.limit,
				}),
			);
		}),
	);

	app.post(
		"/runs/:runId/doc/resolve",
		express.json({ limit: "1mb" }),
		asyncHandler(async (req, res) => {
			const runId = requireRouteParam(req.params.runId, "runId");
			const span = parseRunDocResolvePayload(req.body);
			const resolved = await runService.resolveDocSpan({ runId, span });
			if (!resolved) {
				res.status(404).json({ error: "span not found" });
				return;
			}
			res.json(resolved);
		}),
	);
}
