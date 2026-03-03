import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import process from "node:process";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { loadConfig } from "../../apps/api/src/config";
import {
	type DocRepo,
	type ParseModel,
	PgDocRepo,
	ZaiLayoutClient,
} from "../../apps/api/src/doc";
import { InlineStepRunner } from "../../apps/api/src/durability";
import { PgArtifactRepo } from "../../apps/api/src/repo/postgres";
import { ArtifactService } from "../../apps/api/src/service";
import { S3ArtifactStore } from "../../apps/api/src/storage/s3";
import {
	LazyDbosDocIngestWorkflowLauncher,
	LazyDbosDocOcrWorkflowLauncher,
	createDocOcrQueue,
	registerDocOcrWorkflow,
	registerIngestDocWorkflow,
} from "../../apps/api/src/workflow";
import { queryRows, sleep } from "./live-support";

export type CrashStage = "none" | "ocr" | "index";
export type CrashMode = "disabled" | "first" | "recover";

export type ParseSnapshot = {
	parseId: string;
	status: string;
	usageCount: number;
	chunkCount: number;
	spanCount: number;
	duplicateChunkIds: number;
	chunkMdHashes: string[];
};

export type DocLiveContext = {
	ingestLauncher: LazyDbosDocIngestWorkflowLauncher;
	waitForDone(parseId: string, timeoutMs?: number): Promise<ParseModel>;
	readSnapshot(parseId: string): Promise<ParseSnapshot>;
	resetParse(parseId: string): Promise<void>;
	shutdown(): Promise<void>;
};

const DEFAULT_LIVE_IMAGE_PATH = ".cache/spec07/live-ocr-sample.png";
const DEFAULT_LIVE_IMAGE_URL =
	"https://cdn.bigmodel.cn/static/logo/introduction.png";

function hashText(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function maybeCrashNow(input: {
	stage: CrashStage;
	mode: CrashMode;
	expectedStage: Exclude<CrashStage, "none">;
	crashMarkerPath: string | null;
}): void {
	if (
		input.stage !== input.expectedStage ||
		input.mode !== "first" ||
		!input.crashMarkerPath
	) {
		return;
	}
	if (existsSync(input.crashMarkerPath)) {
		return;
	}
	mkdirSync(dirname(input.crashMarkerPath), { recursive: true });
	writeFileSync(input.crashMarkerPath, `${input.expectedStage}\n`, "utf8");
	process.kill(process.pid, "SIGKILL");
}

function createCrashAwareRepo(
	baseRepo: PgDocRepo,
	input: {
		stage: CrashStage;
		mode: CrashMode;
		crashMarkerPath: string | null;
	},
): Pick<
	DocRepo,
	"getParsePayload" | "upsertParse" | "recordParseLedger" | "markParseDone"
> {
	return {
		getParsePayload: (parseId) => baseRepo.getParsePayload(parseId),
		upsertParse: (value) => baseRepo.upsertParse(value),
		recordParseLedger: (value) => baseRepo.recordParseLedger(value),
		markParseDone: async (value) => {
			maybeCrashNow({
				stage: input.stage,
				mode: input.mode,
				expectedStage: "index",
				crashMarkerPath: input.crashMarkerPath,
			});
			await baseRepo.markParseDone(value);
		},
	};
}

export async function buildSampleDocInput(
	inputPath = DEFAULT_LIVE_IMAGE_PATH,
): Promise<{
	body: Buffer;
	mime: string;
}> {
	if (existsSync(inputPath)) {
		return {
			body: readFileSync(inputPath),
			mime: "image/png",
		};
	}
	const response = await fetch(DEFAULT_LIVE_IMAGE_URL);
	if (!response.ok) {
		throw new Error(
			`failed to fetch live OCR sample image status=${response.status}`,
		);
	}
	const arrayBuffer = await response.arrayBuffer();
	const body = Buffer.from(arrayBuffer);
	if (body.byteLength === 0) {
		throw new Error("live OCR sample image is empty");
	}
	mkdirSync(dirname(inputPath), { recursive: true });
	writeFileSync(inputPath, body);
	return {
		body,
		mime: "image/png",
	};
}

export function readCrashMarker(path: string): string | null {
	if (!existsSync(path)) {
		return null;
	}
	return readFileSync(path, "utf8").trim();
}

export async function createDocLiveContext(input: {
	parserVersion: string;
	normVersion: string;
	crashStage: CrashStage;
	crashMode: CrashMode;
	crashMarkerPath?: string | undefined;
}): Promise<DocLiveContext> {
	const config = loadConfig();
	const artifactRepo = new PgArtifactRepo({
		databaseUrl: config.databaseUrl,
		migrationsDir: "apps/api/migrations",
	});
	const docRepo = new PgDocRepo({
		databaseUrl: config.databaseUrl,
	});
	const store = new S3ArtifactStore({
		endpoint: config.s3Endpoint,
		bucket: config.s3Bucket,
		region: config.s3Region,
		accessKeyId: config.awsAccessKeyId,
		secretAccessKey: config.awsSecretAccessKey,
	});
	await artifactRepo.runMigrations();
	await store.ensureBucket();

	const artifactService = new ArtifactService({
		repo: artifactRepo,
		store,
		s3Bucket: config.s3Bucket,
		stepRunner: new InlineStepRunner(),
	});
	const ocrQueue = createDocOcrQueue({
		workerConcurrency: config.docOcrQueueConcurrency,
		rateLimitPerSecond: config.docOcrQueueRateLimitPerSecond,
	});
	const docOcrLauncher = new LazyDbosDocOcrWorkflowLauncher();
	const docIngestLauncher = new LazyDbosDocIngestWorkflowLauncher();
	const crashMarkerPath = input.crashMarkerPath ?? null;
	const zaiClient = new ZaiLayoutClient({
		endpoint: config.docOcrEndpoint,
		apiKey: config.docOcrApiKey,
		model: config.docOcrModel,
	});

	const ocrWorkflow = registerDocOcrWorkflow({
		repo: createCrashAwareRepo(docRepo, {
			stage: input.crashStage,
			mode: input.crashMode,
			crashMarkerPath,
		}),
		artifactService,
		zaiClient: {
			layoutParsing: async (file) => {
				maybeCrashNow({
					stage: input.crashStage,
					mode: input.crashMode,
					expectedStage: "ocr",
					crashMarkerPath,
				});
				return zaiClient.layoutParsing(file);
			},
		},
		config: {
			model: config.docOcrModel,
		},
	});
	const ingestWorkflow = registerIngestDocWorkflow({
		repo: docRepo,
		artifactService,
		ocrWorkflow: docOcrLauncher,
		config: {
			endpoint: config.docOcrEndpoint,
			model: config.docOcrModel,
			parserVersion: input.parserVersion,
			normVersion: input.normVersion,
			pdfMaxBytes: config.docLimitPdfBytes,
			pdfMaxPages: config.docLimitPdfPages,
			imageMaxBytes: config.docLimitImageBytes,
		},
	});

	DBOS.setConfig({
		systemDatabaseUrl: config.databaseUrl,
		runAdminServer: false,
	});
	await DBOS.launch();
	docOcrLauncher.bind(ocrWorkflow, ocrQueue);
	docIngestLauncher.bind(ingestWorkflow);

	return {
		ingestLauncher: docIngestLauncher,
		waitForDone: async (parseId: string, timeoutMs = 90_000) => {
			const deadline = Date.now() + timeoutMs;
			while (Date.now() < deadline) {
				const parse = await docRepo.getParse(parseId);
				if (!parse) {
					await sleep(200);
					continue;
				}
				if (parse.status === "done") {
					return parse;
				}
				if (parse.status === "failed") {
					throw new Error(`parse failed: ${parseId}`);
				}
				await sleep(200);
			}
			throw new Error(`timed out waiting parse done: ${parseId}`);
		},
		readSnapshot: async (parseId: string): Promise<ParseSnapshot> => {
			const parse = await docRepo.getParse(parseId);
			if (!parse) {
				throw new Error(`parse not found for snapshot: ${parseId}`);
			}
			const usageRows = await queryRows<{ count: string }>(
				"select count(*)::text as count from ocr_usage where parse_id = $1",
				[parseId],
			);
			const chunkRows = await queryRows<{ chunk_id: string; md: string }>(
				"select chunk_id, md from chunks where parse_id = $1 order by chunk_id",
				[parseId],
			);
			const spanRows = await queryRows<{ count: string }>(
				`select count(*)::text as count
				 from spans s
				 join chunks c on c.chunk_id = s.chunk_id
				 where c.parse_id = $1`,
				[parseId],
			);
			const dupRows = await queryRows<{ count: string }>(
				`select count(*)::text as count
				 from (
				 	select chunk_id
				 	from chunks
				 	where parse_id = $1
				 	group by chunk_id
				 	having count(*) > 1
				 ) d`,
				[parseId],
			);
			return {
				parseId,
				status: parse.status,
				usageCount: Number(usageRows[0]?.count ?? "0"),
				chunkCount: chunkRows.length,
				spanCount: Number(spanRows[0]?.count ?? "0"),
				duplicateChunkIds: Number(dupRows[0]?.count ?? "0"),
				chunkMdHashes: chunkRows.map((row) => hashText(row.md)),
			};
		},
		resetParse: async (parseId: string) => {
			await queryRows(
				`delete from parses
				 where parse_id = $1`,
				[parseId],
			);
		},
		shutdown: async () => {
			await DBOS.shutdown({ deregister: true });
			await docRepo.close();
			await artifactRepo.close();
		},
	};
}
