import { describe, expect, it } from "vitest";
import {
	DocAcquireService,
	buildDocSha,
	buildParseId,
	buildRawAlias,
} from "../../apps/api/src/doc";
import type { DocModel, ParseModel } from "../../apps/api/src/doc";

type Store = {
	docs: Map<string, DocModel>;
	parses: Map<string, ParseModel>;
	aliases: Map<string, string>;
};

function createRepo(store: Store) {
	const calls: string[] = [];
	const repo = {
		calls,
		async getDoc(docSha: string): Promise<DocModel | null> {
			calls.push("getDoc");
			return store.docs.get(docSha) ?? null;
		},
		async getParse(parseId: string): Promise<ParseModel | null> {
			calls.push("getParse");
			return store.parses.get(parseId) ?? null;
		},
		async resolveAlias(alias: string): Promise<string | null> {
			calls.push("resolveAlias");
			return store.aliases.get(alias) ?? null;
		},
		async upsertDoc(input: {
			docSha: string;
			mime: string;
			bytes: number;
			rawArtifactSha: string | null;
			status: DocModel["status"];
			createdAt?: string;
			updatedAt?: string;
		}): Promise<DocModel> {
			calls.push("upsertDoc");
			const model: DocModel = {
				docSha: input.docSha,
				mime: input.mime,
				bytes: input.bytes,
				rawArtifactSha: input.rawArtifactSha,
				status: input.status,
				createdAt: input.createdAt ?? "2026-03-01T00:00:00.000Z",
				updatedAt: input.updatedAt ?? "2026-03-01T00:00:00.000Z",
			};
			store.docs.set(model.docSha, model);
			return model;
		},
		async aliasArtifact(input: {
			alias: string;
			sha256: string;
		}): Promise<void> {
			calls.push("aliasArtifact");
			store.aliases.set(input.alias, input.sha256);
		},
		async upsertParse(input: {
			parseId: string;
			docSha: string;
			parser: string;
			parserVersion: string;
			cfgHash: string;
			normVersion: string;
			mdArtifactSha: string | null;
			jsonArtifactSha: string | null;
			stats: Record<string, unknown>;
			status: ParseModel["status"];
			createdAt?: string;
			updatedAt?: string;
		}): Promise<ParseModel> {
			calls.push("upsertParse");
			const model: ParseModel = {
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
				createdAt: input.createdAt ?? "2026-03-01T00:00:00.000Z",
				updatedAt: input.updatedAt ?? "2026-03-01T00:00:00.000Z",
			};
			store.parses.set(model.parseId, model);
			return model;
		},
	};
	return repo;
}

describe("DocAcquireService", () => {
	it("short-circuits completed duplicate acquire", async () => {
		const body = Buffer.from("same bytes");
		const docSha = buildDocSha(body);
		const cfgHash = "c".repeat(64);
		const parseId = buildParseId({
			docSha,
			parser: "glm-ocr",
			parserVersion: "v1",
			cfgHash,
			normVersion: "v1",
		});
		const rawAlias = buildRawAlias(docSha);
		const store: Store = {
			docs: new Map([
				[
					docSha,
					{
						docSha,
						mime: "application/pdf",
						bytes: body.byteLength,
						rawArtifactSha: docSha,
						status: "done",
						createdAt: "2026-03-01T00:00:00.000Z",
						updatedAt: "2026-03-01T00:00:00.000Z",
					},
				],
			]),
			parses: new Map([
				[
					parseId,
					{
						parseId,
						docSha,
						parser: "glm-ocr",
						parserVersion: "v1",
						cfgHash,
						normVersion: "v1",
						mdArtifactSha: null,
						jsonArtifactSha: null,
						stats: {},
						status: "done",
						createdAt: "2026-03-01T00:00:00.000Z",
						updatedAt: "2026-03-01T00:00:00.000Z",
					},
				],
			]),
			aliases: new Map([[rawAlias, docSha]]),
		};
		const repo = createRepo(store);
		const service = new DocAcquireService({ repo });

		const result = await service.acquire({
			body,
			mime: "application/pdf",
			parser: "glm-ocr",
			parserVersion: "v1",
			cfgHash,
			normVersion: "v1",
		});

		expect(result.shortCircuited).toBe(true);
		expect(repo.calls).toEqual(["getDoc", "getParse", "resolveAlias"]);
	});

	it("reserves doc/parse for new acquire and defers raw alias until reserve step", async () => {
		const body = Buffer.from("new bytes");
		const cfgHash = "d".repeat(64);
		const store: Store = {
			docs: new Map(),
			parses: new Map(),
			aliases: new Map(),
		};
		const repo = createRepo(store);
		const service = new DocAcquireService({
			repo,
			now: () => new Date("2026-03-01T00:00:00.000Z"),
		});

		const result = await service.acquire({
			body,
			mime: "application/pdf",
			parser: "glm-ocr",
			parserVersion: "v1",
			cfgHash,
			normVersion: "v1",
		});

		expect(result.shortCircuited).toBe(false);
		expect(result.rawAlias).toBe(`raw/${result.docSha}`);
		expect(store.aliases.has(result.rawAlias)).toBe(false);
		expect(store.docs.get(result.docSha)?.rawArtifactSha).toBeNull();
		expect(store.docs.get(result.docSha)?.status).toBe("queued");
		expect(store.parses.get(result.parseId)?.status).toBe("queued");
		expect(repo.calls).toEqual([
			"getDoc",
			"getParse",
			"resolveAlias",
			"upsertDoc",
			"upsertParse",
		]);
	});

	it("fails fast when raw alias is hijacked", async () => {
		const body = Buffer.from("new bytes");
		const docSha = buildDocSha(body);
		const store: Store = {
			docs: new Map(),
			parses: new Map(),
			aliases: new Map([[buildRawAlias(docSha), "a".repeat(64)]]),
		};
		const repo = createRepo(store);
		const service = new DocAcquireService({ repo });

		await expect(
			service.acquire({
				body,
				mime: "application/pdf",
				parser: "glm-ocr",
				parserVersion: "v1",
				cfgHash: "d".repeat(64),
				normVersion: "v1",
			}),
		).rejects.toThrow("raw alias points to a different doc sha");
	});
});
