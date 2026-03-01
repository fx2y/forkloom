import { resolve } from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { PgArtifactRepo } from "../../apps/api/src/repo/postgres";
import { writeJson } from "../../scripts/harness/live-support";

const DATABASE_URL =
	process.env.DATABASE_URL ??
	process.env.DBOS_SYSTEM_DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/agentos";

describe("doc schema live proof", () => {
	it("applies doc ingest/index migrations and exposes doc tables + indexes live", async () => {
		const repo = new PgArtifactRepo({
			databaseUrl: DATABASE_URL,
			migrationsDir: resolve("apps/api/migrations"),
		});
		await repo.runMigrations();
		await repo.close();

		const pool = new pg.Pool({ connectionString: DATABASE_URL });
		try {
				const tables = await pool.query<{
					docs: string | null;
					parses: string | null;
					pages: string | null;
					blocks: string | null;
					chunks: string | null;
					spans: string | null;
					ocr_usage: string | null;
					chunk_vec: string | null;
					doc_ingested: string | null;
				}>(
					`select
						 to_regclass('public.docs') as docs,
						 to_regclass('public.parses') as parses,
						 to_regclass('public.pages') as pages,
						 to_regclass('public.blocks') as blocks,
						 to_regclass('public.chunks') as chunks,
						 to_regclass('public.spans') as spans,
						 to_regclass('public.ocr_usage') as ocr_usage,
						 to_regclass('public.chunk_vec') as chunk_vec,
						 to_regclass('public.doc_ingested') as doc_ingested`,
				);
			const columns = await pool.query<{ column_name: string }>(
				`select column_name
				 from information_schema.columns
				 where table_schema = 'public'
				   and table_name = 'chunks'
				   and column_name in ('bbox_union', 'plain', 'tsv')
				 order by column_name asc`,
			);
			const indexes = await pool.query<{ indexname: string }>(
				`select indexname
				 from pg_indexes
				 where schemaname = 'public'
				   and indexname in (
					 'docs_status_idx',
					 'parses_doc_status_idx',
					 'chunks_tsv_gin_idx',
					 'chunk_vec_hnsw_idx',
					 'chunk_vec_updated_idx'
				   )
				 order by indexname asc`,
			);
			const vectorExt = await pool.query<{ enabled: boolean }>(
				`select exists(
					 select 1 from pg_extension where extname = 'vector'
				 ) as enabled`,
			);
			const chunkVecColumns = await pool.query<{ column_name: string }>(
				`select column_name
				 from information_schema.columns
				 where table_schema = 'public'
				   and table_name = 'chunk_vec'
				   and column_name in ('emb', 'emb_json')
				 order by column_name asc`,
			);

				expect(tables.rows[0]).toEqual({
					docs: "docs",
					parses: "parses",
					pages: "pages",
					blocks: "blocks",
					chunks: "chunks",
					spans: "spans",
					ocr_usage: "ocr_usage",
					chunk_vec: "chunk_vec",
					doc_ingested: "doc_ingested",
				});
			expect(columns.rows.map((row) => row.column_name)).toEqual([
				"bbox_union",
				"plain",
				"tsv",
			]);
			expect(indexes.rows.map((row) => row.indexname)).toEqual(
				vectorExt.rows[0]?.enabled
					? [
							"chunk_vec_hnsw_idx",
							"chunk_vec_updated_idx",
							"chunks_tsv_gin_idx",
							"docs_status_idx",
							"parses_doc_status_idx",
						]
					: [
							"chunk_vec_updated_idx",
							"chunks_tsv_gin_idx",
							"docs_status_idx",
							"parses_doc_status_idx",
						],
			);
			expect(chunkVecColumns.rows.map((row) => row.column_name)).toEqual(
				vectorExt.rows[0]?.enabled ? ["emb", "emb_json"] : ["emb_json"],
			);

			await writeJson(".cache/test-int/doc-schema-live.json", {
				tables: tables.rows[0] ?? {},
				columns: columns.rows.map((row) => row.column_name),
				chunkVecColumns: chunkVecColumns.rows.map((row) => row.column_name),
				vectorEnabled: vectorExt.rows[0]?.enabled ?? false,
				indexes: indexes.rows.map((row) => row.indexname),
			});
		} finally {
			await pool.end();
		}
	}, 30_000);
});
