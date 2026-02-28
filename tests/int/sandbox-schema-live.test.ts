import { resolve } from "node:path";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { PgArtifactRepo } from "../../apps/api/src/repo/postgres";
import { writeJson } from "../../scripts/harness/live-support";

const DATABASE_URL =
	process.env.DATABASE_URL ??
	process.env.DBOS_SYSTEM_DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/agentos";

describe("sandbox schema live proof", () => {
	it("applies sandbox migration and exposes the queue/lease indexes live", async () => {
		const repo = new PgArtifactRepo({
			databaseUrl: DATABASE_URL,
			migrationsDir: resolve("apps/api/migrations"),
		});
		await repo.runMigrations();
		await repo.close();

		const pool = new pg.Pool({ connectionString: DATABASE_URL });
		try {
			const tables = await pool.query<{
				sandbox: string | null;
				run_command: string | null;
				sandbox_exec: string | null;
			}>(
				`select
					 to_regclass('public.sandbox') as sandbox,
					 to_regclass('public.run_command') as run_command,
					 to_regclass('public.sandbox_exec') as sandbox_exec`,
			);
			const columns = await pool.query<{ column_name: string }>(
				`select column_name
				 from information_schema.columns
				 where table_schema = 'public'
				   and table_name = 'sandbox'
				   and column_name in ('preview_spec', 'lease_expires_at', 'next_command_seq')
				 order by column_name asc`,
			);
			const indexes = await pool.query<{ indexname: string }>(
				`select indexname
				 from pg_indexes
				 where schemaname = 'public'
				   and indexname in (
					 'run_command_run_dedupe_idx',
					 'run_command_lease_idx',
					 'sandbox_exec_run_created_idx'
				   )
				 order by indexname asc`,
			);

			expect(tables.rows[0]).toEqual({
				sandbox: "sandbox",
				run_command: "run_command",
				sandbox_exec: "sandbox_exec",
			});
			expect(columns.rows.map((row) => row.column_name)).toEqual([
				"lease_expires_at",
				"next_command_seq",
				"preview_spec",
			]);
			expect(indexes.rows.map((row) => row.indexname)).toEqual([
				"run_command_lease_idx",
				"run_command_run_dedupe_idx",
				"sandbox_exec_run_created_idx",
			]);

			await writeJson(".cache/test-int/sandbox-schema-live.json", {
				tables: tables.rows[0] ?? {},
				columns: columns.rows.map((row) => row.column_name),
				indexes: indexes.rows.map((row) => row.indexname),
			});
		} finally {
			await pool.end();
		}
	}, 30_000);
});
