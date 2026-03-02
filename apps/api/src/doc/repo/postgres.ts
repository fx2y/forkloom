import pg from "pg";
import { createPoolCloseOnce } from "../../repo/pool-close";
import { buildSpanId } from "../ids";
import type {
	AliasArtifactInput,
	Bbox,
	DocModel,
	DocRepo,
	LexicalChunkHitModel,
	MarkParseDoneInput,
	OcrUsageModel,
	ParseModel,
	ParsePayloadModel,
	RecordParseLedgerInput,
	ResolveSpanModel,
	SearchDocsInput,
	SpanModel,
	UpsertBlockInput,
	UpsertChunkInput,
	UpsertChunkSearchInput,
	UpsertDocInput,
	UpsertOcrUsageInput,
	UpsertPageInput,
	UpsertParseInput,
	UpsertSpanInput,
	VectorChunkModel,
} from "../ports";
import { toPgVectorLiteral } from "../search";

type QueryResultLike<TRow> = {
	rows: TRow[];
	rowCount: number | null;
};

type Queryable = {
	query<TRow = unknown>(
		text: string,
		values?: readonly unknown[],
	): Promise<QueryResultLike<TRow>>;
};

type PoolClientLike = Queryable & { release(): void };

type PoolLike = Queryable & {
	connect(): Promise<PoolClientLike>;
	end(): Promise<void>;
};

type PgRowBase = {
	created_at: Date | string;
	updated_at: Date | string;
};

type DocRow = PgRowBase & {
	doc_sha: string;
	mime: string;
	bytes: string | number;
	raw_artifact_sha: string | null;
	status: DocModel["status"];
};

type ParseRow = PgRowBase & {
	parse_id: string;
	doc_sha: string;
	parser: string;
	parser_ver: string;
	cfg_hash: string;
	norm_ver: string;
	md_artifact_sha: string | null;
	json_artifact_sha: string | null;
	stats: Record<string, unknown> | null;
	status: ParseModel["status"];
};

type OcrUsageRow = PgRowBase & {
	parse_id: string;
	vendor: string;
	model: string;
	input_pages: number;
	input_bytes: string | number;
	output_tokens: number;
	cost_micros: string | number;
	payload: Record<string, unknown> | null;
};

type AliasRow = {
	sha256: string;
};

type LexicalChunkRow = {
	chunk_id: string;
	score: string | number;
	md: string;
	plain: string;
};

type VectorChunkRow = {
	chunk_id: string;
	md: string;
	plain: string;
	emb_json: unknown;
	distance?: string | number | null;
};

type SpanRow = {
	chunk_id: string;
	doc_sha: string;
	parse_id: string;
	p: number;
	bbox: Bbox | null;
	char_start: number | null;
	char_end: number | null;
	block_path: string;
};

type ResolveSpanRow = {
	chunk_id: string;
	doc_sha: string;
	parse_id: string;
	p: number;
	bbox: Bbox | null;
	char_start: number | null;
	char_end: number | null;
	block_path: string;
	chunk_md: string;
	block_md: string | null;
	img_artifact_sha: string | null;
};

export type PgDocRepoDeps = {
	databaseUrl: string;
	pool?: PoolLike | undefined;
};

function asIsoString(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}

function bboxValue(value: Bbox | null): string {
	return JSON.stringify(value);
}

function requireRow<TRow>(
	result: QueryResultLike<TRow>,
	errPrefix: string,
): TRow {
	const row = result.rows[0];
	if (!row) {
		throw new Error(`${errPrefix}: missing row`);
	}
	return row;
}

function requireSingleRow<TRow>(
	result: QueryResultLike<TRow>,
	errPrefix: string,
): TRow {
	if (result.rowCount !== 1) {
		throw new Error(
			`${errPrefix}: expected 1 row, got ${String(result.rowCount)}`,
		);
	}
	return requireRow(result, errPrefix);
}

function toDocModel(row: DocRow): DocModel {
	return {
		docSha: row.doc_sha,
		mime: row.mime,
		bytes: Number(row.bytes),
		rawArtifactSha: row.raw_artifact_sha,
		status: row.status,
		createdAt: asIsoString(row.created_at),
		updatedAt: asIsoString(row.updated_at),
	};
}

function toParseModel(row: ParseRow): ParseModel {
	return {
		parseId: row.parse_id,
		docSha: row.doc_sha,
		parser: row.parser,
		parserVersion: row.parser_ver,
		cfgHash: row.cfg_hash,
		normVersion: row.norm_ver,
		mdArtifactSha: row.md_artifact_sha,
		jsonArtifactSha: row.json_artifact_sha,
		stats: row.stats ?? {},
		status: row.status,
		createdAt: asIsoString(row.created_at),
		updatedAt: asIsoString(row.updated_at),
	};
}

function toOcrUsageModel(row: OcrUsageRow): OcrUsageModel {
	return {
		parseId: row.parse_id,
		vendor: row.vendor,
		model: row.model,
		inputPages: row.input_pages,
		inputBytes: Number(row.input_bytes),
		outputTokens: row.output_tokens,
		costMicros: Number(row.cost_micros),
		payload: row.payload ?? {},
		createdAt: asIsoString(row.created_at),
		updatedAt: asIsoString(row.updated_at),
	};
}

function toScore(value: string | number): number {
	const score = typeof value === "string" ? Number(value) : value;
	if (!Number.isFinite(score)) {
		throw new Error("invalid search score");
	}
	return score;
}

function toEmbedding(value: unknown): number[] {
	const array = Array.isArray(value) ? value : [];
	const embedding: number[] = [];
	for (const item of array) {
		if (typeof item !== "number" || !Number.isFinite(item)) {
			continue;
		}
		embedding.push(item);
	}
	return embedding;
}

function isVectorUnsupportedError(error: unknown): boolean {
	if (!(error instanceof Error)) {
		return false;
	}
	const message = error.message.toLowerCase();
	return (
		message.includes('type "vector" does not exist') ||
		message.includes('column "emb" does not exist') ||
		message.includes("operator does not exist: vector") ||
		message.includes("cannot cast type") ||
		message.includes("dimension")
	);
}

function whereScope(
	scope: SearchDocsInput["scope"],
	alias = "c",
	parseAlias = "p",
	paramStart = 2,
): { sql: string; params: unknown[] } {
	if (scope.docSha) {
		return {
			sql: ` and ${parseAlias}.doc_sha = $${paramStart}`,
			params: [scope.docSha],
		};
	}
	if (scope.parseId) {
		return {
			sql: ` and ${alias}.parse_id = $${paramStart}`,
			params: [scope.parseId],
		};
	}
	return {
		sql: "",
		params: [],
	};
}

export class PgDocRepo implements DocRepo {
	private readonly pool: PoolLike;
	private readonly closePool: () => Promise<void>;

	constructor(deps: PgDocRepoDeps) {
		this.pool =
			deps.pool ?? new pg.Pool({ connectionString: deps.databaseUrl });
		this.closePool = createPoolCloseOnce(this.pool);
	}

	async close(): Promise<void> {
		await this.closePool();
	}

	async getDoc(docSha: string): Promise<DocModel | null> {
		const result = await this.pool.query<DocRow>(
			`select doc_sha, mime, bytes, raw_artifact_sha, status, created_at, updated_at
			 from docs
			 where doc_sha = $1`,
			[docSha],
		);
		const row = result.rows[0];
		return row ? toDocModel(row) : null;
	}

	async getParse(parseId: string): Promise<ParseModel | null> {
		const result = await this.pool.query<ParseRow>(
			`select parse_id, doc_sha, parser, parser_ver, cfg_hash, norm_ver,
			        md_artifact_sha, json_artifact_sha, stats, status, created_at, updated_at
			 from parses
			 where parse_id = $1`,
			[parseId],
		);
		const row = result.rows[0];
		return row ? toParseModel(row) : null;
	}

	async getParsePayload(parseId: string): Promise<ParsePayloadModel | null> {
		const parse = await this.getParse(parseId);
		if (!parse) {
			return null;
		}
		const doc = await this.getDoc(parse.docSha);
		if (!doc) {
			throw new Error(`parse payload missing doc: ${parse.docSha}`);
		}
		const usageResult = await this.pool.query<OcrUsageRow>(
			`select parse_id, vendor, model, input_pages, input_bytes, output_tokens,
			        cost_micros, payload, created_at, updated_at
			 from ocr_usage
			 where parse_id = $1`,
			[parseId],
		);
		return {
			doc,
			parse,
			usage: usageResult.rows[0] ? toOcrUsageModel(usageResult.rows[0]) : null,
		};
	}

	async upsertDoc(input: UpsertDocInput): Promise<DocModel> {
		return this.upsertDocFrom(this.pool, input);
	}

	async upsertParse(input: UpsertParseInput): Promise<ParseModel> {
		return this.upsertParseFrom(this.pool, input);
	}

	async aliasArtifact(input: AliasArtifactInput): Promise<void> {
		await this.aliasArtifactFrom(this.pool, input);
	}

	async resolveAlias(alias: string): Promise<string | null> {
		const result = await this.pool.query<AliasRow>(
			`select sha256
			 from artifact_alias
			 where alias = $1`,
			[alias],
		);
		return result.rows[0]?.sha256 ?? null;
	}

	async searchLexicalChunks(
		input: SearchDocsInput,
	): Promise<LexicalChunkHitModel[]> {
		const scope = whereScope(input.scope);
		const limitIndex = scope.params.length + 2;
		const result = await this.pool.query<LexicalChunkRow>(
			`select
				 c.chunk_id,
				 c.md,
				 c.plain,
				 ts_rank(c.tsv, q) as score
			 from chunks c
			 join parses p on p.parse_id = c.parse_id,
			      websearch_to_tsquery('english', $1) q
			 where c.tsv @@ q${scope.sql}
			 order by score desc, c.chunk_id asc
			 limit $${limitIndex}`,
			[input.query, ...scope.params, input.limit],
		);
		return result.rows.map((row) => ({
			chunkId: row.chunk_id,
			score: toScore(row.score),
			md: row.md,
			plain: row.plain,
		}));
	}

	async listVectorChunks(
		input: SearchDocsInput,
		queryEmbedding?: number[] | undefined,
	): Promise<VectorChunkModel[]> {
		if (queryEmbedding && queryEmbedding.length > 0) {
			try {
				const scope = whereScope(input.scope, "c", "p", 2);
				const limitIndex = scope.params.length + 2;
				const result = await this.pool.query<VectorChunkRow>(
					`select
						 c.chunk_id,
						 c.md,
						 c.plain,
						 cv.emb_json,
						 cv.emb <-> $1::vector as distance
					 from chunk_vec cv
					 join chunks c on c.chunk_id = cv.chunk_id
					 join parses p on p.parse_id = c.parse_id
					 where cv.emb is not null${scope.sql}
					 order by cv.emb <-> $1::vector asc, c.chunk_id asc
					 limit $${limitIndex}`,
					[toPgVectorLiteral(queryEmbedding), ...scope.params, input.limit * 8],
				);
				if (result.rows.length > 0) {
					return result.rows
						.map((row) => ({
							chunkId: row.chunk_id,
							md: row.md,
							plain: row.plain,
							embedding: toEmbedding(row.emb_json),
							distance:
								row.distance == null ? undefined : toScore(row.distance),
						}))
						.filter((row) => row.embedding.length > 0);
				}
			} catch (error) {
				if (!isVectorUnsupportedError(error)) {
					throw error;
				}
			}
		}

		const scope = whereScope(input.scope, "c", "p", 1);
		const limitIndex = scope.params.length + 1;
		const result = await this.pool.query<VectorChunkRow>(
			`select
				 c.chunk_id,
				 c.md,
				 c.plain,
				 cv.emb_json
			 from chunk_vec cv
			 join chunks c on c.chunk_id = cv.chunk_id
			 join parses p on p.parse_id = c.parse_id
			 where jsonb_typeof(cv.emb_json) = 'array'
			   and jsonb_array_length(cv.emb_json) > 0${scope.sql}
			 order by c.updated_at desc, c.chunk_id asc
			 limit $${limitIndex}`,
			[...scope.params, input.limit * 8],
		);
		return result.rows
			.map((row) => ({
				chunkId: row.chunk_id,
				md: row.md,
				plain: row.plain,
				embedding: toEmbedding(row.emb_json),
			}))
			.filter((row) => row.embedding.length > 0);
	}

	async listChunkSpans(chunkIds: string[]): Promise<SpanModel[]> {
		if (chunkIds.length === 0) {
			return [];
		}
		const result = await this.pool.query<SpanRow>(
			`select
				 s.chunk_id,
				 p.doc_sha,
				 c.parse_id,
				 s.p,
				 s.bbox,
				 s.char_start,
				 s.char_end,
				 s.block_path
			 from spans s
			 join chunks c on c.chunk_id = s.chunk_id
			 join parses p on p.parse_id = c.parse_id
			 where s.chunk_id = any($1::text[])
			 order by s.chunk_id asc, s.p asc, s.block_path asc, s.char_start asc nulls first`,
			[chunkIds],
		);
		return result.rows.map((row) => ({
			docSha: row.doc_sha,
			parseId: row.parse_id,
			page: row.p,
			bbox: row.bbox,
			charStart: row.char_start,
			charEnd: row.char_end,
			blockPath: row.block_path,
			chunkId: row.chunk_id,
		}));
	}

	async resolveSpan(span: SpanModel): Promise<ResolveSpanModel | null> {
		const spanId = buildSpanId(span);
		const result = await this.pool.query<ResolveSpanRow>(
			`select
				 s.chunk_id,
				 p.doc_sha,
				 c.parse_id,
				 s.p,
				 s.bbox,
				 s.char_start,
				 s.char_end,
				 s.block_path,
				 c.md as chunk_md,
				 b.text_md as block_md,
				 pg.img_artifact_sha
			 from spans s
			 join chunks c on c.chunk_id = s.chunk_id
			 join parses p on p.parse_id = c.parse_id
			 left join blocks b
			   on b.parse_id = c.parse_id
			  and b.p = s.p
			  and b.block_path = s.block_path
			 left join pages pg
			   on pg.parse_id = c.parse_id
			  and pg.p = s.p
			 where s.span_id = $1`,
			[spanId],
		);
		const row = result.rows[0];
		if (!row) {
			return null;
		}
		const resolvedSpan: SpanModel = {
			docSha: row.doc_sha,
			parseId: row.parse_id,
			page: row.p,
			bbox: row.bbox,
			charStart: row.char_start,
			charEnd: row.char_end,
			blockPath: row.block_path,
			chunkId: row.chunk_id,
		};
		if (
			resolvedSpan.docSha !== span.docSha ||
			resolvedSpan.parseId !== span.parseId ||
			resolvedSpan.chunkId !== span.chunkId
		) {
			return null;
		}
		let md = row.block_md ?? row.chunk_md;
		if (
			row.block_md == null &&
			row.char_start != null &&
			row.char_end != null &&
			row.char_end >= row.char_start &&
			row.char_end <= row.chunk_md.length
		) {
			md = row.chunk_md.slice(row.char_start, row.char_end);
		}
		return {
			span: resolvedSpan,
			md,
			bbox: row.bbox,
			pageImageSha: row.img_artifact_sha,
		};
	}

	async markParseDone(input: MarkParseDoneInput): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			const parseResult = await client.query<{ doc_sha: string }>(
				`update parses
				 set status = 'done',
					 updated_at = $2::timestamptz
				 where parse_id = $1
				 returning doc_sha`,
				[input.parseId, input.publishedAt],
			);
			const docSha = parseResult.rows[0]?.doc_sha;
			if (!docSha) {
				throw new Error(`parse not found for mark done: ${input.parseId}`);
			}
			await client.query(
				`update docs
				 set status = 'done',
					 updated_at = $2::timestamptz
				 where doc_sha = $1`,
				[docSha, input.publishedAt],
			);
			await client.query(
				`insert into doc_ingested(
					 parse_id, doc_sha, published_at, status, created_at, updated_at
				 )
				 values ($1, $2, $3::timestamptz, 'DONE', $3::timestamptz, $3::timestamptz)
				 on conflict (parse_id) do update
				 set doc_sha = excluded.doc_sha,
					 published_at = excluded.published_at,
					 status = excluded.status,
					 updated_at = excluded.updated_at`,
				[input.parseId, docSha, input.publishedAt],
			);
			await client.query("commit");
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	async recordParseLedger(input: RecordParseLedgerInput): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			for (const alias of input.aliases) {
				await this.aliasArtifactFrom(client, alias);
			}
			await this.upsertDocFrom(client, input.doc);
			await this.upsertParseFrom(client, input.parse);
			await this.replacePagesFrom(client, input.parse.parseId, input.pages);
			await this.replaceBlocksFrom(client, input.parse.parseId, input.blocks);
			await this.replaceChunksFrom(client, input.parse.parseId, input.chunks);
			await this.replaceSpansFrom(client, input.parse.parseId, input.spans);
			if (input.usage) {
				await this.upsertOcrUsageFrom(client, input.usage);
			}
			for (const item of input.search) {
				await this.upsertChunkSearchFrom(client, item);
			}
			await client.query("commit");
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	private async upsertDocFrom(
		queryable: Queryable,
		input: UpsertDocInput,
	): Promise<DocModel> {
		const result = await queryable.query<DocRow>(
			`insert into docs(
				 doc_sha, mime, bytes, raw_artifact_sha, status, created_at, updated_at
			 )
			 values (
				 $1, $2, $3, $4, $5, coalesce($6::timestamptz, now()),
				 coalesce($7::timestamptz, now())
			 )
			 on conflict (doc_sha) do update
			 set mime = excluded.mime,
				 bytes = excluded.bytes,
				 raw_artifact_sha = coalesce(excluded.raw_artifact_sha, docs.raw_artifact_sha),
				 status = excluded.status,
				 updated_at = coalesce(excluded.updated_at, now())
			 returning doc_sha, mime, bytes, raw_artifact_sha, status, created_at, updated_at`,
			[
				input.docSha,
				input.mime,
				input.bytes,
				input.rawArtifactSha ?? null,
				input.status,
				input.createdAt ?? null,
				input.updatedAt ?? null,
			],
		);
		return toDocModel(requireSingleRow(result, "upsert doc"));
	}

	private async upsertParseFrom(
		queryable: Queryable,
		input: UpsertParseInput,
	): Promise<ParseModel> {
		const result = await queryable.query<ParseRow>(
			`insert into parses(
				 parse_id, doc_sha, parser, parser_ver, cfg_hash, norm_ver,
				 md_artifact_sha, json_artifact_sha, stats, status, created_at, updated_at
			 )
			 values (
				 $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10,
				 coalesce($11::timestamptz, now()), coalesce($12::timestamptz, now())
			 )
			 on conflict (parse_id) do update
			 set doc_sha = excluded.doc_sha,
				 parser = excluded.parser,
				 parser_ver = excluded.parser_ver,
				 cfg_hash = excluded.cfg_hash,
				 norm_ver = excluded.norm_ver,
				 md_artifact_sha = coalesce(excluded.md_artifact_sha, parses.md_artifact_sha),
				 json_artifact_sha = coalesce(excluded.json_artifact_sha, parses.json_artifact_sha),
				 stats = excluded.stats,
				 status = excluded.status,
				 updated_at = coalesce(excluded.updated_at, now())
			 returning parse_id, doc_sha, parser, parser_ver, cfg_hash, norm_ver,
			 md_artifact_sha, json_artifact_sha, stats, status, created_at, updated_at`,
			[
				input.parseId,
				input.docSha,
				input.parser,
				input.parserVersion,
				input.cfgHash,
				input.normVersion,
				input.mdArtifactSha ?? null,
				input.jsonArtifactSha ?? null,
				JSON.stringify(input.stats),
				input.status,
				input.createdAt ?? null,
				input.updatedAt ?? null,
			],
		);
		return toParseModel(requireSingleRow(result, "upsert parse"));
	}

	private async aliasArtifactFrom(
		queryable: Queryable,
		input: AliasArtifactInput,
	): Promise<void> {
		await queryable.query(
			`insert into artifact_alias(alias, sha256)
			 values ($1, $2)
			 on conflict (alias) do update
			 set sha256 = excluded.sha256`,
			[input.alias, input.sha256],
		);
	}

	private async replacePagesFrom(
		queryable: Queryable,
		parseId: string,
		pages: UpsertPageInput[],
	): Promise<void> {
		await queryable.query("delete from pages where parse_id = $1", [parseId]);
		for (const page of pages) {
			await this.insertPageFrom(queryable, page);
		}
	}

	private async insertPageFrom(
		queryable: Queryable,
		input: UpsertPageInput,
	): Promise<void> {
		await queryable.query(
			`insert into pages(
				 parse_id, p, w, h, img_artifact_sha, md_artifact_sha, json_artifact_sha, status
			 )
			 values ($1, $2, $3, $4, $5, $6, $7, $8)`,
			[
				input.parseId,
				input.page,
				input.width,
				input.height,
				input.imageArtifactSha,
				input.mdArtifactSha,
				input.jsonArtifactSha,
				input.status,
			],
		);
	}

	private async replaceBlocksFrom(
		queryable: Queryable,
		parseId: string,
		blocks: UpsertBlockInput[],
	): Promise<void> {
		await queryable.query("delete from blocks where parse_id = $1", [parseId]);
		for (const block of blocks) {
			await this.insertBlockFrom(queryable, block);
		}
	}

	private async insertBlockFrom(
		queryable: Queryable,
		input: UpsertBlockInput,
	): Promise<void> {
		await queryable.query(
			`insert into blocks(
				 parse_id, p, block_path, kind, bbox, text_md, text_plain, payload, parent_path
			 )
			 values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9)`,
			[
				input.parseId,
				input.page,
				input.blockPath,
				input.kind,
				bboxValue(input.bbox),
				input.textMd,
				input.textPlain,
				JSON.stringify(input.payload),
				input.parentPath,
			],
		);
	}

	private async replaceChunksFrom(
		queryable: Queryable,
		parseId: string,
		chunks: UpsertChunkInput[],
	): Promise<void> {
		await queryable.query("delete from chunks where parse_id = $1", [parseId]);
		for (const chunk of chunks) {
			await this.insertChunkFrom(queryable, chunk);
		}
	}

	private async insertChunkFrom(
		queryable: Queryable,
		input: UpsertChunkInput,
	): Promise<void> {
		await queryable.query(
			`insert into chunks(
				 chunk_id, parse_id, p, kind, md, plain, payload, bbox_union, token_est,
				 prev_chunk_id, next_chunk_id, parent_chunk_id, tsv, created_at, updated_at
			 )
			 values (
				 $1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10, $11, $12,
				 to_tsvector('english', coalesce($6, '')),
				 coalesce($13::timestamptz, now()), coalesce($14::timestamptz, now())
			 )`,
			[
				input.chunkId,
				input.parseId,
				input.page,
				input.kind,
				input.md,
				input.plain,
				JSON.stringify(input.payload),
				bboxValue(input.bboxUnion),
				input.tokenEstimate,
				input.prevChunkId,
				input.nextChunkId,
				input.parentChunkId,
				input.createdAt ?? null,
				input.updatedAt ?? null,
			],
		);
	}

	private async replaceSpansFrom(
		queryable: Queryable,
		parseId: string,
		spans: UpsertSpanInput[],
	): Promise<void> {
		await queryable.query(
			`delete from spans
			 where chunk_id in (
				 select chunk_id from chunks where parse_id = $1
			 )`,
			[parseId],
		);
		for (const span of spans) {
			await this.insertSpanFrom(queryable, span);
		}
	}

	private async insertSpanFrom(
		queryable: Queryable,
		input: UpsertSpanInput,
	): Promise<void> {
		await queryable.query(
			`insert into spans(
				 span_id, chunk_id, p, bbox, char_start, char_end, block_path, src_ref
			 )
			 values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8::jsonb)`,
			[
				buildSpanId(input),
				input.chunkId,
				input.page,
				bboxValue(input.bbox),
				input.charStart,
				input.charEnd,
				input.blockPath,
				JSON.stringify({
					docSha: input.docSha,
					parseId: input.parseId,
				}),
			],
		);
	}

	private async upsertOcrUsageFrom(
		queryable: Queryable,
		input: UpsertOcrUsageInput,
	): Promise<OcrUsageModel> {
		const result = await queryable.query<OcrUsageRow>(
			`insert into ocr_usage(
				 parse_id, vendor, model, input_pages, input_bytes, output_tokens,
				 cost_micros, payload, created_at, updated_at
			 )
			 values (
				 $1, $2, $3, $4, $5, $6, $7, $8::jsonb,
				 coalesce($9::timestamptz, now()), coalesce($10::timestamptz, now())
			 )
			 on conflict (parse_id) do update
			 set vendor = excluded.vendor,
				 model = excluded.model,
				 input_pages = excluded.input_pages,
				 input_bytes = excluded.input_bytes,
				 output_tokens = excluded.output_tokens,
				 cost_micros = excluded.cost_micros,
				 payload = excluded.payload,
				 updated_at = coalesce(excluded.updated_at, now())
			 returning parse_id, vendor, model, input_pages, input_bytes, output_tokens,
			 cost_micros, payload, created_at, updated_at`,
			[
				input.parseId,
				input.vendor,
				input.model,
				input.inputPages,
				input.inputBytes,
				input.outputTokens,
				input.costMicros,
				JSON.stringify(input.payload),
				input.createdAt ?? null,
				input.updatedAt ?? null,
			],
		);
		const row = requireSingleRow(result, "upsert ocr usage");
		return toOcrUsageModel(row);
	}

	private async upsertChunkSearchFrom(
		queryable: Queryable,
		input: UpsertChunkSearchInput,
	): Promise<void> {
		await queryable.query(
			`update chunks
			 set tsv = to_tsvector('english', coalesce(plain, '')),
				 updated_at = now()
			 where chunk_id = $1`,
			[input.chunkId],
		);
		if (input.embedding == null) {
			await queryable.query("delete from chunk_vec where chunk_id = $1", [
				input.chunkId,
			]);
			return;
		}
		if (!input.embedding.every((value) => Number.isFinite(value))) {
			throw new Error("chunk search embedding must be finite");
		}
		try {
			await queryable.query(
				`insert into chunk_vec(chunk_id, emb_json, emb, updated_at)
				 values ($1, $2::jsonb, $3::vector, now())
				 on conflict (chunk_id) do update
				 set emb_json = excluded.emb_json,
					 emb = excluded.emb,
					 updated_at = excluded.updated_at`,
				[
					input.chunkId,
					JSON.stringify(input.embedding),
					toPgVectorLiteral(input.embedding),
				],
			);
		} catch (error) {
			if (!isVectorUnsupportedError(error)) {
				throw error;
			}
			await queryable.query(
				`insert into chunk_vec(chunk_id, emb_json, updated_at)
				 values ($1, $2::jsonb, now())
				 on conflict (chunk_id) do update
				 set emb_json = excluded.emb_json,
					 updated_at = excluded.updated_at`,
				[input.chunkId, JSON.stringify(input.embedding)],
			);
		}
	}
}
