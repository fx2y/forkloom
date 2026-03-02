import { DBOS } from "@dbos-inc/dbos-sdk";
import {
	DOC_PARSER,
	DocAcquireService,
	buildParseCfgHash,
	classifyDoc,
	transitionParseStatus,
} from "../doc";
import type { DocModel, DocRepo, ParseModel } from "../doc";
import type { ArtifactService } from "../service";
import type { DocOcrWorkflowLauncher } from "./doc-ocr-runtime";

type IngestCoreStepName =
	| "acquire"
	| "classify"
	| "reserve"
	| "enqueue"
	| "markFailed";

type IngestStepRunner = {
	runStep<T>(name: IngestCoreStepName, fn: () => Promise<T>): Promise<T>;
};

export type ExecuteIngestDocInput = {
	body: Buffer;
	mime: string;
};

export type IngestDocWorkflowInput = {
	bodyBase64: string;
	mime: string;
};

export type IngestDocOutput = {
	docSha: string;
	parseId: string;
	status: "queued" | "rejected" | "deduped";
	reason?: string | undefined;
};

type IngestRepo = Pick<
	DocRepo,
	| "getDoc"
	| "getParse"
	| "upsertDoc"
	| "upsertParse"
	| "aliasArtifact"
	| "resolveAlias"
>;

export type IngestDocDeps = {
	repo: IngestRepo;
	artifactService: Pick<ArtifactService, "putArtifact">;
	ocrWorkflow: DocOcrWorkflowLauncher;
	config: {
		endpoint: string;
		model: string;
		parserVersion: string;
		normVersion: string;
		pdfMaxBytes: number;
		pdfMaxPages: number;
		imageMaxBytes: number;
	};
	now?: (() => Date) | undefined;
};

export type RegisteredIngestDocWorkflow = (
	input: IngestDocWorkflowInput,
) => Promise<IngestDocOutput>;

const dbosStepRunner: IngestStepRunner = {
	runStep<T>(name: IngestCoreStepName, fn: () => Promise<T>): Promise<T> {
		return DBOS.runStep(fn, { name });
	},
};

function decodeBody(bodyBase64: string): Buffer {
	if (!bodyBase64) {
		throw new Error("IngestDocV1 requires bodyBase64");
	}
	return Buffer.from(bodyBase64, "base64");
}

function toDocOcrAttemptWorkflowId(parseId: string, stampIso: string): string {
	const nonce = stampIso.replace(/[^0-9A-Za-z]/g, "");
	return `doc_ocr:${parseId}:${nonce}`;
}

async function markRejected(
	repo: IngestRepo,
	doc: DocModel,
	parse: ParseModel,
	nowIso: string,
): Promise<void> {
	await repo.upsertDoc({
		docSha: doc.docSha,
		mime: doc.mime,
		bytes: doc.bytes,
		rawArtifactSha: doc.rawArtifactSha,
		status: "failed",
		updatedAt: nowIso,
	});
	await repo.upsertParse({
		parseId: parse.parseId,
		docSha: parse.docSha,
		parser: parse.parser,
		parserVersion: parse.parserVersion,
		cfgHash: parse.cfgHash,
		normVersion: parse.normVersion,
		mdArtifactSha: parse.mdArtifactSha,
		jsonArtifactSha: parse.jsonArtifactSha,
		stats: parse.stats,
		status:
			parse.status === "failed"
				? "failed"
				: transitionParseStatus(parse.status, "failed"),
		updatedAt: nowIso,
	});
}

export async function executeIngestDoc(
	input: ExecuteIngestDocInput,
	deps: IngestDocDeps,
	steps: IngestStepRunner = dbosStepRunner,
): Promise<IngestDocOutput> {
	const now = deps.now ?? (() => new Date());
	const acquireService = new DocAcquireService({
		repo: deps.repo,
		now,
	});
	const cfgHash = buildParseCfgHash({
		endpoint: deps.config.endpoint,
		model: deps.config.model,
		parserVersion: deps.config.parserVersion,
		normVersion: deps.config.normVersion,
		pdfMaxBytes: deps.config.pdfMaxBytes,
		pdfMaxPages: deps.config.pdfMaxPages,
		imageMaxBytes: deps.config.imageMaxBytes,
	});

	const acquired = await steps.runStep("acquire", async () =>
		acquireService.acquire({
			body: input.body,
			mime: input.mime,
			parser: DOC_PARSER,
			parserVersion: deps.config.parserVersion,
			cfgHash,
			normVersion: deps.config.normVersion,
		}),
	);
	if (acquired.shortCircuited) {
		return {
			docSha: acquired.docSha,
			parseId: acquired.parseId,
			status: "deduped",
			reason:
				acquired.shortCircuitState === "inflight"
					? "in_progress"
					: acquired.shortCircuitState === "done"
						? "already_done"
						: undefined,
		};
	}

	const classification = await steps.runStep("classify", async () =>
		classifyDoc({
			mime: input.mime,
			bytes: input.body.byteLength,
			body: input.body,
			pdfMaxBytes: deps.config.pdfMaxBytes,
			pdfMaxPages: deps.config.pdfMaxPages,
			imageMaxBytes: deps.config.imageMaxBytes,
		}),
	);
	if (!classification.accepted) {
		await steps.runStep("markFailed", async () =>
			markRejected(
				deps.repo,
				acquired.doc,
				acquired.parse,
				now().toISOString(),
			),
		);
		return {
			docSha: acquired.docSha,
			parseId: acquired.parseId,
			status: "rejected",
			reason: classification.code,
		};
	}

	await steps.runStep("reserve", async () => {
		await deps.artifactService.putArtifact({
			body: Buffer.from(input.body),
			mime: input.mime,
			type: "raw",
			meta: {
				"doc.sha": acquired.docSha,
				"parse.id": acquired.parseId,
				"parse.stage": "queued",
			},
			expectedSha256: acquired.docSha,
		});
		await deps.repo.aliasArtifact({
			alias: acquired.rawAlias,
			sha256: acquired.docSha,
		});
		const stamp = now().toISOString();
		await deps.repo.upsertDoc({
			docSha: acquired.doc.docSha,
			mime: acquired.doc.mime,
			bytes: acquired.doc.bytes,
			rawArtifactSha: acquired.docSha,
			status: acquired.doc.status === "done" ? "done" : "processing",
			updatedAt: stamp,
		});
		await deps.repo.upsertParse({
			parseId: acquired.parse.parseId,
			docSha: acquired.parse.docSha,
			parser: acquired.parse.parser,
			parserVersion: acquired.parse.parserVersion,
			cfgHash: acquired.parse.cfgHash,
			normVersion: acquired.parse.normVersion,
			mdArtifactSha: acquired.parse.mdArtifactSha,
			jsonArtifactSha: acquired.parse.jsonArtifactSha,
			stats: acquired.parse.stats,
			status: acquired.parse.status === "done" ? "done" : "queued",
			updatedAt: stamp,
		});
	});

	const enqueue = await steps.runStep("enqueue", async () => ({
		parseId: acquired.parseId,
		shouldEnqueue: true,
		workflowID: toDocOcrAttemptWorkflowId(
			acquired.parseId,
			now().toISOString(),
		),
	}));
	if (enqueue.shouldEnqueue) {
		await deps.ocrWorkflow.enqueueDocOcr({
			parseId: enqueue.parseId,
			workflowID: enqueue.workflowID,
		});
	}

	return {
		docSha: acquired.docSha,
		parseId: acquired.parseId,
		status: "queued",
	};
}

let activeDeps: IngestDocDeps | null = null;
let registeredWorkflow: RegisteredIngestDocWorkflow | null = null;

export function registerIngestDocWorkflow(
	deps: IngestDocDeps,
): RegisteredIngestDocWorkflow {
	activeDeps = deps;
	if (!registeredWorkflow) {
		registeredWorkflow = DBOS.registerWorkflow(
			async (input: IngestDocWorkflowInput): Promise<IngestDocOutput> => {
				const currentDeps = activeDeps;
				if (!currentDeps) {
					throw new Error("IngestDocV1 deps are not registered");
				}
				return executeIngestDoc(
					{
						body: decodeBody(input.bodyBase64),
						mime: input.mime,
					},
					currentDeps,
					dbosStepRunner,
				);
			},
			{
				name: "IngestDocV1",
			},
		);
	}
	return registeredWorkflow;
}
