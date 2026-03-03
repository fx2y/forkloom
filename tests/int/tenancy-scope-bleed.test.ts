import pg from "pg";
import { describe, expect, it } from "vitest";

const DATABASE_URL =
	process.env.DATABASE_URL ??
	process.env.DBOS_SYSTEM_DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/agentos";

const SCOPE_A = {
	orgId: "00000000-0000-0000-0000-0000000000a1",
	wsId: "00000000-0000-0000-0000-0000000000b1",
};
const SCOPE_B = {
	orgId: "00000000-0000-0000-0000-0000000000a2",
	wsId: "00000000-0000-0000-0000-0000000000b2",
};
const RUN_A = "rls-live-run-a";
const RLS_ROLE = "forkloom_rls_test";

describe("tenancy scope tx bleed", () => {
	it("keeps app.* context transaction-local on pooled connections", async () => {
		const pool = new pg.Pool({ connectionString: DATABASE_URL });
		const client = await pool.connect();
		try {
			await client.query(
				`do $$
				 begin
				   if not exists (select 1 from pg_roles where rolname = '${RLS_ROLE}') then
				     execute 'create role ${RLS_ROLE} nologin';
				   end if;
				 end $$;`,
			);
			await client.query(`grant usage on schema public to ${RLS_ROLE}`);
			await client.query(
				`grant select, insert, update, delete on all tables in schema public to ${RLS_ROLE}`,
			);
			await client.query(
				`grant usage, select on all sequences in schema public to ${RLS_ROLE}`,
			);
			await client.query(`set role ${RLS_ROLE}`);
			await client.query("begin");
			await client.query("select set_config('app.org_id', $1, true)", [
				SCOPE_A.orgId,
			]);
			await client.query("select set_config('app.ws_id', $1, true)", [
				SCOPE_A.wsId,
			]);
			await client.query("select set_config('app.member_id', $1, true)", [""]);
			const tx1 = await client.query<{ org_id: string | null }>(
				`select current_setting('app.org_id', true) as org_id`,
			);
			await client.query("commit");
			expect(tx1.rows[0]?.org_id).toBe(SCOPE_A.orgId);

			await client.query("begin");
			const tx2Setting = await client.query<{ org_id: string | null }>(
				`select current_setting('app.org_id', true) as org_id`,
			);
			const tx2Rows = await client.query<{ n: string }>(
				"select count(*)::text as n from runs where run_id = $1",
				[RUN_A],
			);
			await client.query("commit");
			expect(tx2Setting.rows[0]?.org_id ?? "").toBe("");
			expect(Number(tx2Rows.rows[0]?.n ?? "0")).toBe(0);

			await client.query("begin");
			await client.query("select set_config('app.org_id', $1, true)", [
				SCOPE_B.orgId,
			]);
			await client.query("select set_config('app.ws_id', $1, true)", [
				SCOPE_B.wsId,
			]);
			await client.query("select set_config('app.member_id', $1, true)", [""]);
			const tx3Rows = await client.query<{ n: string }>(
				"select count(*)::text as n from runs where run_id = $1",
				[RUN_A],
			);
			await client.query("commit");
			expect(Number(tx3Rows.rows[0]?.n ?? "0")).toBe(0);
		} finally {
			await client.query("reset role");
			client.release();
			await pool.end();
		}
	}, 30_000);
});
