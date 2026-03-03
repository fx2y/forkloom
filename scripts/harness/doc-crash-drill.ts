import { existsSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import {
	type CrashStage,
	buildSampleDocInput,
	createDocLiveContext,
	readCrashMarker,
} from "./doc-live-support";
import { writeJson } from "./live-support";

type Mode = "first" | "recover" | "aggregate";

type StageReport = {
	status: "ok" | "fail";
	stage: CrashStage;
	mode: Exclude<Mode, "aggregate">;
	scenarioId: string;
	parseId: string;
	ingestStatus: string;
	parseStatus: string;
	usageCount: number;
	chunkCount: number;
	spanCount: number;
	duplicateChunkIds: number;
	chunkMdHashes: string[];
	crashMarker: string | null;
};

function parseMode(raw: string | undefined): Mode {
	if (raw === "first" || raw === "recover" || raw === "aggregate") {
		return raw;
	}
	throw new Error(
		"usage: tsx scripts/harness/doc-crash-drill.ts <first|recover|aggregate> <stage|ocr-report-path> <scenarioId|index-report-path> [output-path]",
	);
}

function parseStage(raw: string | undefined): CrashStage {
	if (raw === "ocr" || raw === "index") {
		return raw;
	}
	throw new Error("stage must be one of: ocr|index");
}

function diffHashes(
	before: string[],
	after: string[],
): {
	missing: string[];
	unexpected: string[];
	hashMismatches: string[];
} {
	const beforeSet = new Set(before);
	const afterSet = new Set(after);
	const missing = [...beforeSet].filter((value) => !afterSet.has(value));
	const unexpected = [...afterSet].filter((value) => !beforeSet.has(value));
	const hashMismatches: string[] = [];
	return { missing, unexpected, hashMismatches };
}

async function runStage(
	mode: Exclude<Mode, "aggregate">,
	input: {
		stage: CrashStage;
		scenarioId: string;
		outputPath: string;
	},
): Promise<void> {
	const crashMarkerPath = `.cache/spec07/doc-crash-${input.stage}.${input.scenarioId}.marker`;
	const parserVersion = `v1-crash-${input.stage}-${input.scenarioId}`;
	const context = await createDocLiveContext({
		parserVersion,
		normVersion: "v1-crash",
		crashStage: input.stage,
		crashMode: mode,
		crashMarkerPath,
	});
	try {
		const sample = await buildSampleDocInput();
		const ingest = await context.ingestLauncher.startIngestDoc(
			{
				body: sample.body,
				mime: sample.mime,
			},
			{
				workflowID: `doc_ingest:crash:${input.stage}:${input.scenarioId}`,
			},
		);

		if (mode === "first") {
			// first mode should be terminated by SIGKILL inside OCR/index stage.
			await context.waitForDone(ingest.parseId, 30_000);
			throw new Error("expected process kill did not occur in first mode");
		}

		const parse = await context.waitForDone(ingest.parseId, 90_000);
		const snapshot = await context.readSnapshot(ingest.parseId);
		const crashMarker = readCrashMarker(crashMarkerPath);
		const status =
			parse.status === "done" &&
			snapshot.usageCount === 1 &&
			snapshot.chunkCount > 0 &&
			snapshot.spanCount > 0 &&
			snapshot.duplicateChunkIds === 0 &&
			crashMarker === input.stage
				? "ok"
				: "fail";
		await writeJson(input.outputPath, {
			status,
			stage: input.stage,
			mode,
			scenarioId: input.scenarioId,
			parseId: ingest.parseId,
			ingestStatus: ingest.status,
			parseStatus: parse.status,
			usageCount: snapshot.usageCount,
			chunkCount: snapshot.chunkCount,
			spanCount: snapshot.spanCount,
			duplicateChunkIds: snapshot.duplicateChunkIds,
			chunkMdHashes: snapshot.chunkMdHashes,
			crashMarker,
		});
		if (status !== "ok") {
			throw new Error(
				`doc crash ${input.stage} recover checks failed (parse=${parse.status} usage=${snapshot.usageCount})`,
			);
		}
	} finally {
		await context.shutdown();
	}
}

async function runAggregate(input: {
	ocrPath: string;
	indexPath: string;
	outputPath: string;
}): Promise<void> {
	const ocr = JSON.parse(readFileSync(input.ocrPath, "utf8")) as StageReport;
	const index = JSON.parse(
		readFileSync(input.indexPath, "utf8"),
	) as StageReport;
	const diff = diffHashes(ocr.chunkMdHashes, index.chunkMdHashes);
	const duplicateChunkIds = [
		...(ocr.duplicateChunkIds > 0 ? [`ocr:${ocr.duplicateChunkIds}`] : []),
		...(index.duplicateChunkIds > 0
			? [`index:${index.duplicateChunkIds}`]
			: []),
	];
	const status =
		ocr.status === "ok" &&
		index.status === "ok" &&
		diff.missing.length === 0 &&
		diff.unexpected.length === 0 &&
		diff.hashMismatches.length === 0 &&
		duplicateChunkIds.length === 0
			? "ok"
			: "fail";
	await writeJson(input.outputPath, {
		status,
		stage: "doc-index-resume",
		ocr,
		index,
		beforeRowCount: ocr.chunkMdHashes.length,
		resumeRowCount: index.chunkMdHashes.length,
		diff: {
			...diff,
			duplicateChunkIds,
		},
	});
	if (status !== "ok") {
		throw new Error(
			`doc crash aggregate failed: missing=${diff.missing.length} unexpected=${diff.unexpected.length} hash=${diff.hashMismatches.length} dup=${duplicateChunkIds.length}`,
		);
	}
}

async function main(): Promise<void> {
	const [modeArg, arg1, arg2, arg3] = process.argv.slice(2);
	const mode = parseMode(modeArg);
	if (mode === "aggregate") {
		if (!arg1 || !arg2) {
			throw new Error(
				"aggregate mode requires <ocr-report-path> <index-report-path> [output-path]",
			);
		}
		await runAggregate({
			ocrPath: arg1,
			indexPath: arg2,
			outputPath: arg3 ?? ".cache/spec07/cy10-crash.report.json",
		});
		return;
	}
	const stage = parseStage(arg1);
	const scenarioId = arg2 ?? "default";
	const outputPath =
		arg3 ?? `.cache/spec07/cy10-crash.${stage}.${mode}.${scenarioId}.json`;
	await runStage(mode, {
		stage,
		scenarioId,
		outputPath,
	});
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
