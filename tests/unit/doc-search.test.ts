import type { SpanRef } from "@forkloom/contracts";
import { describe, expect, it } from "vitest";
import { buildDeterministicEmbedding, DocService } from "../../apps/api/src/doc";
import type { DocRepo } from "../../apps/api/src/doc";

const BASE_SPAN: SpanRef = {
	docSha: "a".repeat(64),
	parseId: "p".repeat(64),
	page: 1,
	bbox: [1, 2, 3, 4],
	charStart: null,
	charEnd: null,
	blockPath: "1.000001",
	chunkId: "chunk-a",
};

function createRepo(): DocRepo {
	return {
		async getDoc() {
			return null;
		},
		async getParse() {
			return null;
		},
		async getParsePayload() {
			return null;
		},
		async upsertDoc() {
			throw new Error("not used");
		},
		async upsertParse() {
			throw new Error("not used");
		},
		async aliasArtifact() {
			return;
		},
		async resolveAlias() {
			return null;
		},
		async recordParseLedger() {
			return;
		},
		async searchLexicalChunks() {
			return [
				{
					chunkId: "chunk-a",
					score: 2,
					md: "alpha",
					plain: "alpha",
				},
				{
					chunkId: "chunk-b",
					score: 1,
					md: "beta",
					plain: "beta",
				},
			];
		},
		async listVectorChunks() {
			return [
				{
					chunkId: "chunk-b",
					md: "beta",
					plain: "beta",
					embedding: buildDeterministicEmbedding("budget query"),
				},
				{
					chunkId: "chunk-c",
					md: "gamma",
					plain: "gamma",
					embedding: buildDeterministicEmbedding("budget query"),
				},
			];
		},
		async listChunkSpans(chunkIds) {
			return chunkIds.flatMap((chunkId) =>
				chunkId === "chunk-c"
					? []
					: [{ ...BASE_SPAN, chunkId, blockPath: chunkId === "chunk-a" ? "1.000001" : "1.000002" }],
			);
		},
		async resolveSpan(span) {
			return {
				span,
				md: "exact md slice",
				bbox: span.bbox,
				pageImageSha: null,
			};
		},
		async markParseDone() {
			return;
		},
	};
}

describe("doc search service", () => {
	it("merges lexical + vector scores and enforces SpanRef presence", async () => {
		const service = new DocService({ repo: createRepo() });
		const result = await service.searchDocs({
			query: "budget query",
			scope: "all",
			limit: 10,
		});
		expect(result.query).toBe("budget query");
		expect(result.hits.map((hit) => hit.chunkId)).toEqual(["chunk-a", "chunk-b"]);
		expect(result.hits.every((hit) => hit.spans.length > 0)).toBe(true);
	});

	it("resolves spans from durable row truth", async () => {
		const service = new DocService({ repo: createRepo() });
		const resolved = await service.resolveSpan(BASE_SPAN);
		expect(resolved).toEqual({
			span: BASE_SPAN,
			md: "exact md slice",
			bbox: [1, 2, 3, 4],
			pageImageSha: null,
		});
	});
});

