import { describe, expect, it } from "vitest";
import type { DocStatus, ParseStatus } from "../../apps/api/src/doc";
import { PgDocRepo } from "../../apps/api/src/doc";

type StubResult = {
	rows?: unknown[] | undefined;
	rowCount?: number | null | undefined;
	error?: Error | undefined;
};

type Call = {
	sql: string;
	params: readonly unknown[] | undefined;
};

class StubClient {
	public readonly calls: Call[] = [];

	constructor(private readonly queue: StubResult[]) {}

	async query<TRow = unknown>(
		sql: string,
		params?: readonly unknown[],
	): Promise<{ rows: TRow[]; rowCount: number | null }> {
		this.calls.push({ sql, params });
		const next = this.queue.shift() ?? {};
		if (next.error) {
			throw next.error;
		}
		return {
			rows: (next.rows ?? []) as TRow[],
			rowCount: next.rowCount ?? ((next.rows?.length ?? 0) > 0 ? 1 : 0),
		};
	}

	release(): void {
		return;
	}
}

class StubPool extends StubClient {
	async connect(): Promise<StubClient> {
		return this;
	}

	async end(): Promise<void> {
		return;
	}
}

const ISO = "2026-03-01T00:00:00.000Z";
const DOC_SHA = "a".repeat(64);
const PARSE_ID = `${DOC_SHA}:glm-ocr:v1:cfg0`;

function docRow(overrides: Record<string, unknown> = {}) {
	return {
		doc_sha: DOC_SHA,
		mime: "application/pdf",
		bytes: 128,
		raw_artifact_sha: DOC_SHA,
		status: "processing" as DocStatus,
		created_at: ISO,
		updated_at: ISO,
		...overrides,
	};
}

function parseRow(overrides: Record<string, unknown> = {}) {
	return {
		parse_id: PARSE_ID,
		doc_sha: DOC_SHA,
		parser: "glm-ocr",
		parser_ver: "v1",
		cfg_hash: "cfg0",
		norm_ver: "norm-v1",
		md_artifact_sha: "b".repeat(64),
		json_artifact_sha: "c".repeat(64),
		stats: { pages: 1 },
		status: "ocr_done" as ParseStatus,
		created_at: ISO,
		updated_at: ISO,
		...overrides,
	};
}

function ocrUsageRow(overrides: Record<string, unknown> = {}) {
	return {
		parse_id: PARSE_ID,
		vendor: "zai",
		model: "glm-ocr",
		input_pages: 1,
		input_bytes: 128,
		output_tokens: 32,
		cost_micros: 17,
		payload: { latencyMs: 50 },
		created_at: ISO,
		updated_at: ISO,
		...overrides,
	};
}

describe("PgDocRepo", () => {
	it("records doc, alias, layout, and search rows in one transaction", async () => {
		const pool = new StubPool([
			{},
			{},
			{},
			{ rows: [docRow()], rowCount: 1 },
			{ rows: [parseRow()], rowCount: 1 },
			{},
			{},
			{},
			{},
			{},
			{},
			{},
			{},
			{ rows: [ocrUsageRow()], rowCount: 1 },
			{},
			{},
			{},
		]);
		const repo = new PgDocRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		await repo.recordParseLedger({
			doc: {
				docSha: DOC_SHA,
				mime: "application/pdf",
				bytes: 128,
				rawArtifactSha: DOC_SHA,
				status: "processing",
				createdAt: ISO,
				updatedAt: ISO,
			},
			parse: {
				parseId: PARSE_ID,
				docSha: DOC_SHA,
				parser: "glm-ocr",
				parserVersion: "v1",
				cfgHash: "cfg0",
				normVersion: "norm-v1",
				mdArtifactSha: "b".repeat(64),
				jsonArtifactSha: "c".repeat(64),
				stats: { pages: 1 },
				status: "ocr_done",
				createdAt: ISO,
				updatedAt: ISO,
			},
			aliases: [
				{ alias: `raw/${DOC_SHA}`, sha256: DOC_SHA },
				{ alias: `parse/${PARSE_ID}.md`, sha256: "b".repeat(64) },
			],
			pages: [
				{
					parseId: PARSE_ID,
					page: 1,
					width: 800,
					height: 1000,
					imageArtifactSha: null,
					mdArtifactSha: "b".repeat(64),
					jsonArtifactSha: "c".repeat(64),
					status: "ocr_done",
				},
			],
			blocks: [
				{
					parseId: PARSE_ID,
					page: 1,
					blockPath: "0.1",
					kind: "P",
					bbox: [1, 2, 3, 4],
					textMd: "hello",
					textPlain: "hello",
					payload: { kind: "paragraph" },
					parentPath: null,
				},
			],
			chunks: [
				{
					chunkId: "chunk:abc",
					parseId: PARSE_ID,
					page: 1,
					kind: "section",
					md: "hello",
					plain: "hello",
					payload: { order: 1 },
					bboxUnion: [1, 2, 3, 4],
					tokenEstimate: 1,
					prevChunkId: null,
					nextChunkId: null,
					parentChunkId: null,
					createdAt: ISO,
					updatedAt: ISO,
				},
			],
			spans: [
				{
					docSha: DOC_SHA,
					parseId: PARSE_ID,
					page: 1,
					bbox: [1, 2, 3, 4],
					charStart: null,
					charEnd: null,
					blockPath: "0.1",
					chunkId: "chunk:abc",
				},
			],
			usage: {
				parseId: PARSE_ID,
				vendor: "zai",
				model: "glm-ocr",
				inputPages: 1,
				inputBytes: 128,
				outputTokens: 32,
				costMicros: 17,
				payload: { latencyMs: 50 },
				createdAt: ISO,
				updatedAt: ISO,
			},
			search: [{ chunkId: "chunk:abc", embedding: [0.1, 0.2, 0.3] }],
		});

		expect(pool.calls.map((call) => call.sql.toLowerCase())).toEqual([
			"begin",
			expect.stringContaining("insert into artifact_alias"),
			expect.stringContaining("insert into artifact_alias"),
			expect.stringContaining("insert into docs"),
			expect.stringContaining("insert into parses"),
			expect.stringContaining("delete from pages"),
			expect.stringContaining("insert into pages"),
			expect.stringContaining("delete from blocks"),
			expect.stringContaining("insert into blocks"),
			expect.stringContaining("delete from chunks"),
			expect.stringContaining("insert into chunks"),
			expect.stringContaining("delete from spans"),
			expect.stringContaining("insert into spans"),
			expect.stringContaining("insert into ocr_usage"),
			expect.stringContaining("update chunks"),
			expect.stringContaining("insert into chunk_vec"),
			"commit",
		]);
		expect(pool.calls[15]?.params?.[1]).toBe("[0.1,0.2,0.3]");
	});
});
