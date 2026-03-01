import { hashBytes, hashJSON } from "@forkloom/shared";
import { describe, expect, it } from "vitest";
import type { ArtifactModel, PutArtifactInput } from "../../apps/api/src/ports";
import type {
	DocRepo,
	OcrUsageModel,
	RecordParseLedgerInput,
} from "../../apps/api/src/doc";
import { executeDocOcr } from "../../apps/api/src/workflow/doc-ocr";
import { executeIngestDoc } from "../../apps/api/src/workflow/doc-ingest";

const ISO = "2026-03-01T00:00:00.000Z";
const inlineSteps = {
	runStep: async <T>(_name: string, fn: () => Promise<T>): Promise<T> => fn(),
};

type Store = {
	docs: Map<string, Awaited<ReturnType<DocRepo["upsertDoc"]>>>;
	parses: Map<string, Awaited<ReturnType<DocRepo["upsertParse"]>>>;
	aliases: Map<string, string>;
	usage: Map<string, OcrUsageModel>;
	recordLedgerCalls: RecordParseLedgerInput[];
};

function createStore(): Store {
	return {
		docs: new Map(),
		parses: new Map(),
		aliases: new Map(),
		usage: new Map(),
		recordLedgerCalls: [],
	};
}

function createRepo(store: Store): DocRepo {
	return {
		async getDoc(docSha) {
			return store.docs.get(docSha) ?? null;
		},
		async getParse(parseId) {
			return store.parses.get(parseId) ?? null;
		},
		async getParsePayload(parseId) {
			const parse = store.parses.get(parseId);
			if (!parse) {
				return null;
			}
			const doc = store.docs.get(parse.docSha);
			if (!doc) {
				return null;
			}
			return {
				doc,
				parse,
				usage: store.usage.get(parseId) ?? null,
			};
		},
		async upsertDoc(input) {
			const current = store.docs.get(input.docSha);
			const next = {
				docSha: input.docSha,
				mime: input.mime,
				bytes: input.bytes,
				rawArtifactSha: input.rawArtifactSha,
				status: input.status,
				createdAt: input.createdAt ?? current?.createdAt ?? ISO,
				updatedAt: input.updatedAt ?? ISO,
			};
			store.docs.set(next.docSha, next);
			return next;
		},
		async upsertParse(input) {
			const current = store.parses.get(input.parseId);
			const next = {
				parseId: input.parseId,
				docSha: input.docSha,
				parser: input.parser,
				parserVersion: input.parserVersion,
				cfgHash: input.cfgHash,
				normVersion: input.normVersion,
				mdArtifactSha: input.mdArtifactSha,
				jsonArtifactSha: input.jsonArtifactSha,
				stats: input.stats,
				status: input.status,
				createdAt: input.createdAt ?? current?.createdAt ?? ISO,
				updatedAt: input.updatedAt ?? ISO,
			};
			store.parses.set(next.parseId, next);
			return next;
		},
		async aliasArtifact(input) {
			store.aliases.set(input.alias, input.sha256);
		},
		async resolveAlias(alias) {
			return store.aliases.get(alias) ?? null;
		},
		async recordParseLedger(input) {
			store.recordLedgerCalls.push(input);
			await this.upsertDoc(input.doc);
			await this.upsertParse(input.parse);
			for (const alias of input.aliases) {
				await this.aliasArtifact(alias);
			}
			if (input.usage) {
				store.usage.set(input.usage.parseId, {
					...input.usage,
					createdAt: input.usage.createdAt ?? ISO,
					updatedAt: input.usage.updatedAt ?? ISO,
				});
			}
		},
	};
}

function createArtifactService(logs: {
	putArtifact: string[];
	putJSON: string[];
}) {
	const toArtifactModel = (sha256: string, mime: string, bytes: number): ArtifactModel => ({
		sha256,
		uri: `s3://agentos/cas/${sha256.slice(0, 2)}/${sha256}`,
		mime,
		bytes,
		createdAt: ISO,
		type: "raw",
		parents: [],
		meta: {},
	});
	return {
		async putArtifact(input: PutArtifactInput): Promise<ArtifactModel> {
			const sha256 = hashBytes(input.body);
			if (input.expectedSha256 && input.expectedSha256 !== sha256) {
				throw new Error("sha mismatch");
			}
			logs.putArtifact.push(String(input.meta["parse.variant"] ?? "raw"));
			return {
				...toArtifactModel(sha256, input.mime, input.body.byteLength),
				type: input.type,
				meta: input.meta,
			};
		},
		async putJSON(input: {
			value: unknown;
			meta: Record<string, unknown>;
			parents?: string[] | undefined;
			type?: PutArtifactInput["type"] | undefined;
			mime?: string | undefined;
		}): Promise<ArtifactModel> {
			logs.putJSON.push(String(input.meta["parse.variant"] ?? "json"));
			const sha256 = hashJSON(input.value);
			return {
				...toArtifactModel(
					sha256,
					input.mime ?? "application/json",
					Buffer.from(JSON.stringify(input.value)).byteLength,
				),
				type: input.type ?? "json",
				meta: input.meta,
				parents: input.parents ?? [],
			};
		},
		async getArtifactMeta(sha256: string): Promise<ArtifactModel> {
			return toArtifactModel(sha256, "application/pdf", 128);
		},
	};
}

describe("doc workflows", () => {
	it("runs acquire->classify->reserve->enqueue in ingest workflow core", async () => {
		const store = createStore();
		const repo = createRepo(store);
		const artifactLogs = { putArtifact: [] as string[], putJSON: [] as string[] };
		const artifactService = createArtifactService(artifactLogs);
		const enqueued: string[] = [];
		const steps: string[] = [];

		const output = await executeIngestDoc(
			{
				body: Buffer.from("%PDF-1.7\n/Type /Page\n"),
				mime: "application/pdf",
			},
			{
				repo,
				artifactService,
				ocrWorkflow: {
					enqueueDocOcr: async (input) => {
						enqueued.push(input.parseId);
					},
				},
				config: {
					endpoint: "https://api.z.ai/api/paas/v4/layout_parsing",
					model: "glm-ocr",
					parserVersion: "v1",
					normVersion: "v1",
					pdfMaxBytes: 50_000_000,
					pdfMaxPages: 100,
					imageMaxBytes: 10_000_000,
				},
				now: () => new Date(ISO),
			},
			{
				runStep: async (name, fn) => {
					steps.push(name);
					return fn();
				},
			},
		);

		expect(output.status).toBe("queued");
		expect(steps).toEqual(["acquire", "classify", "reserve", "enqueue"]);
		expect(enqueued).toEqual([output.parseId]);
		expect(store.parses.get(output.parseId)?.status).toBe("queued");
		expect(artifactLogs.putArtifact).toContain("raw");
	});

	it("rejects over-limit docs and marks parse/doc as failed", async () => {
		const store = createStore();
		const repo = createRepo(store);
		const artifactService = createArtifactService({
			putArtifact: [],
			putJSON: [],
		});
		const enqueued: string[] = [];
		const result = await executeIngestDoc(
			{
				body: Buffer.alloc(11, 1),
				mime: "image/png",
			},
			{
				repo,
				artifactService,
				ocrWorkflow: {
					enqueueDocOcr: async (input) => {
						enqueued.push(input.parseId);
					},
				},
				config: {
					endpoint: "https://api.z.ai/api/paas/v4/layout_parsing",
					model: "glm-ocr",
					parserVersion: "v1",
					normVersion: "v1",
					pdfMaxBytes: 50_000_000,
					pdfMaxPages: 100,
					imageMaxBytes: 10,
				},
				now: () => new Date(ISO),
			},
			inlineSteps,
		);

		expect(result.status).toBe("rejected");
		expect(result.reason).toBe("image_bytes_limit");
		expect(enqueued).toEqual([]);
		expect(store.docs.get(result.docSha)?.status).toBe("failed");
		expect(store.parses.get(result.parseId)?.status).toBe("failed");
	});

	it("returns cached OCR payload without re-billing", async () => {
		const store = createStore();
		const repo = createRepo(store);
		const docSha = "a".repeat(64);
		const parseId = "b".repeat(64);
		await repo.upsertDoc({
			docSha,
			mime: "application/pdf",
			bytes: 100,
			rawArtifactSha: docSha,
			status: "processing",
		});
		await repo.upsertParse({
			parseId,
			docSha,
			parser: "glm-ocr",
			parserVersion: "v1",
			cfgHash: "c".repeat(64),
			normVersion: "v1",
			mdArtifactSha: "d".repeat(64),
			jsonArtifactSha: "e".repeat(64),
			stats: {},
			status: "ocr_done",
		});
		let calls = 0;
		const result = await executeDocOcr(
			parseId,
			{
				repo,
				artifactService: createArtifactService({
					putArtifact: [],
					putJSON: [],
				}),
				zaiClient: {
					layoutParsing: async () => {
						calls += 1;
						throw new Error("should not call layout_parsing");
					},
				},
				config: {
					model: "glm-ocr",
				},
			},
			inlineSteps,
		);

		expect(result.status).toBe("cached");
		expect(calls).toBe(0);
	});

	it("persists raw+norm artifacts and bills OCR once per parse", async () => {
		const store = createStore();
		const repo = createRepo(store);
		const artifactLogs = { putArtifact: [] as string[], putJSON: [] as string[] };
		const artifactService = createArtifactService(artifactLogs);
		const docSha = "f".repeat(64);
		const parseId = "1".repeat(64);

		await repo.upsertDoc({
			docSha,
			mime: "application/pdf",
			bytes: 128,
			rawArtifactSha: docSha,
			status: "queued",
		});
		await repo.upsertParse({
			parseId,
			docSha,
			parser: "glm-ocr",
			parserVersion: "v1",
			cfgHash: "2".repeat(64),
			normVersion: "v1",
			mdArtifactSha: null,
			jsonArtifactSha: null,
			stats: {},
			status: "queued",
		});

		let layoutCalls = 0;
		const deps = {
			repo,
			artifactService,
			zaiClient: {
				layoutParsing: async () => {
					layoutCalls += 1;
					return {
						markdown: "# T\n\nx\n",
						layoutDetails: [
							[
								{
									index: 0,
									label: "P",
									bbox2d: [0, 0, 1, 1] as [number, number, number, number],
									content: "x",
									width: 1000,
									height: 1200,
								},
							],
						],
						pageCount: 1,
						usage: {
							inputPages: 1,
							outputTokens: 12,
							costMicros: 21,
							raw: { output_tokens: 12 },
						},
						raw: {
							md_results: "# T\n\nx\n",
							layout_details: [[]],
							data_info: { num_pages: 1 },
						},
					};
				},
			},
			config: {
				model: "glm-ocr",
			},
			now: () => new Date(ISO),
		};

		const first = await executeDocOcr(parseId, deps, inlineSteps);
		const second = await executeDocOcr(parseId, deps, inlineSteps);

		expect(first.status).toBe("processed");
		expect(second.status).toBe("cached");
		expect(layoutCalls).toBe(1);
		expect(store.recordLedgerCalls).toHaveLength(1);
		expect(store.recordLedgerCalls[0]?.usage?.parseId).toBe(parseId);
		expect(store.recordLedgerCalls[0]?.aliases.some((alias) => alias.alias.endsWith(".md.raw"))).toBe(true);
		expect(artifactLogs.putArtifact).toContain("md.raw");
		expect(artifactLogs.putJSON).toContain("json.raw");
		expect(store.parses.get(parseId)?.status).toBe("ocr_done");
	});
});
