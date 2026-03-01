import { describe, expect, it } from "vitest";
import {
	buildChunkId,
	buildChunkJsonAlias,
	buildChunkMdAlias,
	buildDocSha,
	buildParseCfgHash,
	buildParseId,
	buildParseJsonAlias,
	buildParseMdAlias,
	buildRawAlias,
	buildSpanId,
} from "../../apps/api/src/doc";

describe("doc id and alias helpers", () => {
	it("builds deterministic doc/parse/chunk ids", () => {
		const body = Buffer.from("doc bytes", "utf8");
		const docSha = buildDocSha(body);
		const cfgHash = buildParseCfgHash({
			endpoint: "https://api.z.ai/api/paas/v4/layout_parsing",
			model: "glm-ocr",
			parserVersion: "v1",
			normVersion: "v1",
			pdfMaxBytes: 50_000_000,
			pdfMaxPages: 100,
			imageMaxBytes: 10_000_000,
		});
		const parseId = buildParseId({
			docSha,
			parser: "glm-ocr",
			parserVersion: "v1",
			cfgHash,
			normVersion: "v1",
		});
		const chunkId = buildChunkId({
			parseId,
			page: 2,
			blockPath: "0.1.2",
			normMd: "# Hello\n",
		});

		expect(docSha).toMatch(/^[a-f0-9]{64}$/);
		expect(cfgHash).toMatch(/^[a-f0-9]{64}$/);
		expect(parseId).toMatch(/^[a-f0-9]{64}$/);
		expect(chunkId).toMatch(/^[a-f0-9]{64}$/);
		expect(
			buildChunkId({
				parseId,
				page: 2,
				blockPath: "0.1.2",
				normMd: "# Hello\n",
			}),
		).toBe(chunkId);
	});

	it("prefers bbox for span ids and falls back to char range", () => {
		const withBbox = buildSpanId({
			docSha: "a".repeat(64),
			parseId: "b".repeat(64),
			page: 1,
			bbox: [1, 2, 3, 4],
			charStart: 2,
			charEnd: 9,
			blockPath: "0.1",
			chunkId: "chunk:1",
		});
		const withChars = buildSpanId({
			docSha: "a".repeat(64),
			parseId: "b".repeat(64),
			page: 1,
			bbox: null,
			charStart: 2,
			charEnd: 9,
			blockPath: "0.1",
			chunkId: "chunk:1",
		});

		expect(withBbox.endsWith(":1,2,3,4")).toBe(true);
		expect(withChars.endsWith(":2:9")).toBe(true);
	});

	it("builds logical aliases on top of CAS ids", () => {
		const docSha = "a".repeat(64);
		const parseId = "b".repeat(64);
		const chunkId = "chunk:abc";

		expect(buildRawAlias(docSha)).toBe(`raw/${docSha}`);
		expect(buildParseMdAlias(parseId)).toBe(`parse/${parseId}.md`);
		expect(buildParseJsonAlias(parseId)).toBe(`parse/${parseId}.json`);
		expect(buildChunkMdAlias(chunkId)).toBe(`chunks/${chunkId}.md`);
		expect(buildChunkJsonAlias(chunkId)).toBe(`chunks/${chunkId}.json`);
	});
});
