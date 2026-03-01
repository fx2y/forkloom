import { DBOS } from "@dbos-inc/dbos-sdk";
import {
	buildParseJsonAlias,
	buildParseMdAlias,
	buildParseRawJsonAlias,
	buildParseRawMdAlias,
	canonicalParseStatus,
	normalizeJsonValue,
	normalizeMarkdown,
	transitionParseStatus,
} from "../doc";
import type { DocRepo, ParsePayloadModel, ParseStatusState } from "../doc";
import type { ZaiLayoutResult } from "../doc";
import type { ZaiLayoutClient } from "../doc";
import type { ArtifactService } from "../service";

type DocOcrStepName =
	| "loadParsePayload"
	| "markRunning"
	| "callLayoutParsing"
	| "persistOcr"
	| "markFailed";

type DocOcrStepRunner = {
	runStep<T>(name: DocOcrStepName, fn: () => Promise<T>): Promise<T>;
};

export type DocOcrOutput = {
	parseId: string;
	status: "cached" | "processed";
	mdArtifactSha: string | null;
	jsonArtifactSha: string | null;
};

type DocOcrRepo = Pick<
	DocRepo,
	"getParsePayload" | "upsertParse" | "recordParseLedger"
>;

export type DocOcrDeps = {
	repo: DocOcrRepo;
	artifactService: Pick<ArtifactService, "getArtifactMeta" | "putArtifact" | "putJSON">;
	zaiClient: Pick<ZaiLayoutClient, "layoutParsing">;
	config: {
		model: string;
	};
	now?: (() => Date) | undefined;
};

export type RegisteredDocOcrWorkflow = (parseId: string) => Promise<DocOcrOutput>;

const OCR_DONE_STATUSES = new Set<ParseStatusState>([
	"ocr_done",
	"norm_done",
	"indexed",
	"done",
]);

const dbosStepRunner: DocOcrStepRunner = {
	runStep<T>(name: DocOcrStepName, fn: () => Promise<T>): Promise<T> {
		return DBOS.runStep(fn, { name });
	},
};

function assertPayload(payload: ParsePayloadModel | null): ParsePayloadModel {
	if (!payload) {
		throw new Error("parse payload missing");
	}
	return payload;
}

function isCachedStatus(status: ParsePayloadModel["parse"]["status"]): boolean {
	return OCR_DONE_STATUSES.has(canonicalParseStatus(status));
}

function buildPageRows(ocr: ZaiLayoutResult, parseId: string) {
	const count = Math.max(1, ocr.pageCount);
	const rows = [];
	for (let page = 1; page <= count; page += 1) {
		const entries = ocr.layoutDetails[page - 1] ?? [];
		const sizeFromLayout = entries.find(
			(entry) => entry.width > 0 && entry.height > 0,
		);
		rows.push({
			parseId,
			page,
			width: sizeFromLayout?.width ?? null,
			height: sizeFromLayout?.height ?? null,
			imageArtifactSha: null,
			mdArtifactSha: null,
			jsonArtifactSha: null,
			status: "ocr_done" as const,
		});
	}
	return rows;
}

async function markParseStatus(
	repo: DocOcrRepo,
	payload: ParsePayloadModel,
	nextStatus: ParseStatusState,
	stamp: string,
) {
	const currentStatus = canonicalParseStatus(payload.parse.status);
	const status =
		currentStatus === nextStatus
			? payload.parse.status
			: transitionParseStatus(payload.parse.status, nextStatus);
	return repo.upsertParse({
		parseId: payload.parse.parseId,
		docSha: payload.parse.docSha,
		parser: payload.parse.parser,
		parserVersion: payload.parse.parserVersion,
		cfgHash: payload.parse.cfgHash,
		normVersion: payload.parse.normVersion,
		mdArtifactSha: payload.parse.mdArtifactSha,
		jsonArtifactSha: payload.parse.jsonArtifactSha,
		stats: payload.parse.stats,
		status,
		updatedAt: stamp,
	});
}

export async function executeDocOcr(
	parseId: string,
	deps: DocOcrDeps,
	steps: DocOcrStepRunner = dbosStepRunner,
): Promise<DocOcrOutput> {
	const now = deps.now ?? (() => new Date());
	let payload = await steps.runStep("loadParsePayload", async () =>
		deps.repo.getParsePayload(parseId),
	);
	const initial = assertPayload(payload);

	if (isCachedStatus(initial.parse.status)) {
		// return cached payload and skip layout_parsing billing.
		return {
			parseId: initial.parse.parseId,
			status: "cached",
			mdArtifactSha: initial.parse.mdArtifactSha,
			jsonArtifactSha: initial.parse.jsonArtifactSha,
		};
	}

	try {
		const running = await steps.runStep("markRunning", async () =>
			markParseStatus(
				deps.repo,
				initial,
				"ocr_running",
				now().toISOString(),
			),
		);
		payload = {
			...initial,
			parse: running,
		};

		const ocr = await steps.runStep("callLayoutParsing", async () => {
			const rawSha = assertPayload(payload).doc.rawArtifactSha;
			if (!rawSha) {
				throw new Error(`parse ${parseId} missing raw artifact sha`);
			}
			const rawMeta = await deps.artifactService.getArtifactMeta(rawSha);
			return deps.zaiClient.layoutParsing(rawMeta.uri);
		});

		return steps.runStep("persistOcr", async () => {
			const current = assertPayload(payload);
			const rawMd = await deps.artifactService.putArtifact({
				body: Buffer.from(ocr.markdown, "utf8"),
				mime: "text/markdown",
				type: "raw",
				meta: {
					"parse.id": current.parse.parseId,
					"parse.variant": "md.raw",
				},
			});
			const rawJson = await deps.artifactService.putJSON({
				value: ocr.raw,
				type: "raw",
				meta: {
					"parse.id": current.parse.parseId,
					"parse.variant": "json.raw",
				},
			});
			const normalizedMarkdown = normalizeMarkdown(ocr.markdown);
			const normMd = await deps.artifactService.putArtifact({
				body: Buffer.from(normalizedMarkdown, "utf8"),
				mime: "text/markdown",
				type: "raw",
				meta: {
					"parse.id": current.parse.parseId,
					"parse.variant": "md",
				},
			});
			const normalizedJson = normalizeJsonValue({
				layout_details: ocr.layoutDetails.map((page) =>
					page.map((entry) => ({
						index: entry.index,
						label: entry.label,
						bbox_2d: entry.bbox2d,
						content: entry.content,
						width: entry.width,
						height: entry.height,
					})),
				),
				data_info: {
					num_pages: ocr.pageCount,
				},
			});
			const normJson = await deps.artifactService.putJSON({
				value: normalizedJson,
				meta: {
					"parse.id": current.parse.parseId,
					"parse.variant": "json",
				},
				parents: [rawJson.sha256],
			});
			const stamp = now().toISOString();
			const parseStats = {
				...current.parse.stats,
				ocr: {
					pages: ocr.pageCount,
					outputTokens: ocr.usage.outputTokens,
					costMicros: ocr.usage.costMicros,
				},
			};
			await deps.repo.recordParseLedger({
				doc: {
					docSha: current.doc.docSha,
					mime: current.doc.mime,
					bytes: current.doc.bytes,
					rawArtifactSha: current.doc.rawArtifactSha,
					status: current.doc.status === "done" ? "done" : "processing",
					updatedAt: stamp,
				},
				parse: {
					parseId: current.parse.parseId,
					docSha: current.parse.docSha,
					parser: current.parse.parser,
					parserVersion: current.parse.parserVersion,
					cfgHash: current.parse.cfgHash,
					normVersion: current.parse.normVersion,
					mdArtifactSha: normMd.sha256,
					jsonArtifactSha: normJson.sha256,
					stats: parseStats,
					status: transitionParseStatus(current.parse.status, "ocr_done"),
					updatedAt: stamp,
				},
				aliases: [
					{ alias: buildParseRawMdAlias(current.parse.parseId), sha256: rawMd.sha256 },
					{
						alias: buildParseRawJsonAlias(current.parse.parseId),
						sha256: rawJson.sha256,
					},
					{ alias: buildParseMdAlias(current.parse.parseId), sha256: normMd.sha256 },
					{
						alias: buildParseJsonAlias(current.parse.parseId),
						sha256: normJson.sha256,
					},
				],
				pages: buildPageRows(ocr, current.parse.parseId),
				blocks: [],
				chunks: [],
				spans: [],
				usage: {
					parseId: current.parse.parseId,
					vendor: "zai",
					model: deps.config.model,
					inputPages: ocr.usage.inputPages,
					inputBytes: current.doc.bytes,
					outputTokens: ocr.usage.outputTokens,
					costMicros: ocr.usage.costMicros,
					payload: {
						usage: ocr.usage.raw,
					},
					updatedAt: stamp,
				},
				search: [],
			});
			return {
				parseId: current.parse.parseId,
				status: "processed" as const,
				mdArtifactSha: normMd.sha256,
				jsonArtifactSha: normJson.sha256,
			};
		});
	} catch (error) {
		const current = assertPayload(payload);
		await steps.runStep("markFailed", async () =>
			markParseStatus(
				deps.repo,
				current,
				"failed",
				now().toISOString(),
			),
		);
		throw error;
	}
}

let activeDeps: DocOcrDeps | null = null;
let registeredWorkflow: RegisteredDocOcrWorkflow | null = null;

export function registerDocOcrWorkflow(
	deps: DocOcrDeps,
): RegisteredDocOcrWorkflow {
	activeDeps = deps;
	if (!registeredWorkflow) {
		registeredWorkflow = DBOS.registerWorkflow(
			async (parseId: string): Promise<DocOcrOutput> => {
				const currentDeps = activeDeps;
				if (!currentDeps) {
					throw new Error("Doc OCR deps are not registered");
				}
				return executeDocOcr(parseId, currentDeps, dbosStepRunner);
			},
			{
				name: "DocOcrV1",
			},
		);
	}
	return registeredWorkflow;
}
