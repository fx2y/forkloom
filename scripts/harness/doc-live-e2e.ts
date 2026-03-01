import { pathToFileURL } from "node:url";
import {
	buildSamplePdfBytes,
	createDocLiveContext,
} from "./doc-live-support";
import { writeJson } from "./live-support";

type IngestProof = {
	docSha: string;
	parseId: string;
	status: "queued" | "rejected" | "deduped";
	reason?: string | undefined;
};

async function main(): Promise<void> {
	const outputPath = process.argv[2] ?? ".cache/spec07/cy6-live-e2e.json";
	const parserVersion = `v1-live-e2e-${Date.now()}`;
	const normVersion = "v1-live-e2e";
	const context = await createDocLiveContext({
		parserVersion,
		normVersion,
		crashStage: "none",
		crashMode: "disabled",
	});
	try {
		const body = buildSamplePdfBytes();
		const first = (await context.ingestLauncher.startIngestDoc(
			{
				body,
				mime: "application/pdf",
			},
			{
				workflowID: `doc_ingest:e2e:first:${Date.now()}`,
			},
		)) as IngestProof;
		if (first.status === "rejected") {
			throw new Error(`live ingest unexpectedly rejected: ${first.reason ?? "?"}`);
		}
		await context.waitForDone(first.parseId, 90_000);

		const second = (await context.ingestLauncher.startIngestDoc(
			{
				body,
				mime: "application/pdf",
			},
			{
				workflowID: `doc_ingest:e2e:second:${Date.now()}`,
			},
		)) as IngestProof;
		await context.waitForDone(second.parseId, 90_000);
		const snapshot = await context.readSnapshot(first.parseId);

		const status =
			first.status === "queued" &&
			second.status === "deduped" &&
			first.parseId === second.parseId &&
			snapshot.status === "done" &&
			snapshot.usageCount === 1 &&
			snapshot.chunkCount > 0 &&
			snapshot.spanCount > 0 &&
			snapshot.duplicateChunkIds === 0
				? "ok"
				: "fail";

		await writeJson(outputPath, {
			status,
			first,
			second,
			snapshot,
			checks: {
				firstQueued: first.status === "queued",
				secondDeduped: second.status === "deduped",
				sameParseId: first.parseId === second.parseId,
				done: snapshot.status === "done",
				usageOnce: snapshot.usageCount === 1,
				chunksPresent: snapshot.chunkCount > 0,
				spansPresent: snapshot.spanCount > 0,
				noDuplicateChunkIds: snapshot.duplicateChunkIds === 0,
			},
		});

		if (status !== "ok") {
			throw new Error("doc live e2e checks failed");
		}
	} finally {
		await context.shutdown();
	}
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
