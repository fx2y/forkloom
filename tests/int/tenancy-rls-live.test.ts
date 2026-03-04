import { resolve } from "node:path";
import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { PgArtifactRepo } from "../../apps/api/src/repo/postgres";

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
const MEMBER_SCOPE_A = {
	orgId: SCOPE_A.orgId,
	wsId: SCOPE_A.wsId,
	memberId: "00000000-0000-0000-0000-0000000000c1",
};
const RUN_A = "rls-live-run-a";
const RUN_BAD = "rls-live-run-bad";
const POLICY_UNION_KEY = "policy/rls-union";
const POLICY_STRICT_KEY = "policy/rls-strict-check";
const RLS_ROLE = "forkloom_rls_test";

type Queryable = {
	query<TRow = unknown>(
		text: string,
		values?: readonly unknown[],
	): Promise<{ rows: TRow[] }>;
};

async function withScopedTx<T>(
	db: Queryable,
	scope: {
		orgId: string;
		wsId?: string | undefined;
		memberId?: string | undefined;
	},
	fn: () => Promise<T>,
): Promise<T> {
	await db.query("begin");
	try {
		await db.query("select set_config('app.org_id', $1, true)", [scope.orgId]);
		await db.query("select set_config('app.ws_id', $1, true)", [
			scope.wsId ?? "",
		]);
		await db.query("select set_config('app.member_id', $1, true)", [
			scope.memberId ?? "",
		]);
		const result = await fn();
		await db.query("commit");
		return result;
	} catch (error) {
		await db.query("rollback");
		throw error;
	}
}

describe("tenancy RLS live", () => {
	beforeAll(async () => {
		const repo = new PgArtifactRepo({
			databaseUrl: DATABASE_URL,
			migrationsDir: resolve("apps/api/migrations"),
		});
		await repo.runMigrations();
		await repo.close();

		const pool = new pg.Pool({ connectionString: DATABASE_URL });
		try {
			await pool.query(
				`do $$
				 begin
				   if not exists (select 1 from pg_roles where rolname = '${RLS_ROLE}') then
				     execute 'create role ${RLS_ROLE} nologin';
				   end if;
				 end $$;`,
			);
			await pool.query(`grant usage on schema public to ${RLS_ROLE}`);
			await pool.query(
				`grant select, insert, update, delete on all tables in schema public to ${RLS_ROLE}`,
			);
			await pool.query(
				`grant usage, select on all sequences in schema public to ${RLS_ROLE}`,
			);
			await pool.query(
				`insert into org(org_id, name)
				 values ($1, 'rls-org-a'), ($2, 'rls-org-b')
				 on conflict (org_id) do nothing`,
				[SCOPE_A.orgId, SCOPE_B.orgId],
			);
				await pool.query(
					`insert into workspace(ws_id, org_id, name)
					 values ($1, $2, 'rls-ws-a'), ($3, $4, 'rls-ws-b')
					 on conflict (ws_id) do nothing`,
					[SCOPE_A.wsId, SCOPE_A.orgId, SCOPE_B.wsId, SCOPE_B.orgId],
				);
				await pool.query(
					`insert into member(member_id, org_id, email)
					 values ($1, $2, 'rls-member-a@example.com')
					 on conflict (member_id) do nothing`,
					[MEMBER_SCOPE_A.memberId, MEMBER_SCOPE_A.orgId],
				);
			} finally {
				await pool.end();
			}
	}, 30_000);

	it("enforces default-deny and scope-isolated reads/writes", async () => {
		const pool = new pg.Pool({ connectionString: DATABASE_URL });
			const client = await pool.connect();
			try {
				await client.query(
					`delete from object_kv
					 where org_id = $1::uuid
					   and kind = 'policy'
					   and key in ($2, $3)`,
					[SCOPE_A.orgId, POLICY_UNION_KEY, POLICY_STRICT_KEY],
				);
				await client.query(`set role ${RLS_ROLE}`);
				await withScopedTx(client, SCOPE_A, async () => {
					await client.query("delete from events where run_id in ($1, $2)", [
					RUN_A,
					RUN_BAD,
				]);
				await client.query(
					"delete from run_artifacts where run_id in ($1, $2)",
					[RUN_A, RUN_BAD],
				);
				await client.query("delete from runs where run_id in ($1, $2)", [
					RUN_A,
					RUN_BAD,
				]);
				await client.query(
					`insert into runs(run_id, status, spec, org_id, ws_id, member_id)
					 values ($1, 'queued', $2::jsonb, $3::uuid, $4::uuid, null)`,
					[
						RUN_A,
						JSON.stringify({
							runId: RUN_A,
							scope: "team",
							userMsg: "rls",
							attachments: [],
							orgId: SCOPE_A.orgId,
							wsId: SCOPE_A.wsId,
							writeTarget: "ws",
						}),
						SCOPE_A.orgId,
						SCOPE_A.wsId,
					],
				);
				await client.query(
					`insert into events(run_id, kind, payload, org_id, ws_id, member_id)
					 values ($1, 'run_started', '{}'::jsonb, $2::uuid, $3::uuid, null)`,
					[RUN_A, SCOPE_A.orgId, SCOPE_A.wsId],
				);
			});

			const aCount = await withScopedTx(client, SCOPE_A, async () => {
				const result = await client.query<{ n: string }>(
					"select count(*)::text as n from runs where run_id = $1",
					[RUN_A],
				);
				return Number(result.rows[0]?.n ?? "0");
			});
			expect(aCount).toBe(1);

			const bCount = await withScopedTx(client, SCOPE_B, async () => {
				const result = await client.query<{ n: string }>(
					"select count(*)::text as n from runs where run_id = $1",
					[RUN_A],
				);
				return Number(result.rows[0]?.n ?? "0");
			});
			expect(bCount).toBe(0);

			await client.query("begin");
			const unsetCount = await client.query<{ n: string }>(
				"select count(*)::text as n from runs where run_id = $1",
				[RUN_A],
			);
			await client.query("commit");
			expect(Number(unsetCount.rows[0]?.n ?? "0")).toBe(0);

				await expect(
					withScopedTx(client, SCOPE_A, async () => {
						await client.query(
							`insert into runs(run_id, status, spec, org_id, ws_id, member_id)
							 values ($1, 'queued', '{}'::jsonb, $2::uuid, $3::uuid, null)`,
							[RUN_BAD, SCOPE_B.orgId, SCOPE_B.wsId],
						);
					}),
				).rejects.toThrowError(/row-level security/i);

				await withScopedTx(client, { orgId: SCOPE_A.orgId }, async () => {
					await client.query(
						`insert into object_kv(kind, key, org_id, ws_id, member_id, body_artifact_sha, updated_at)
						 values ('policy', $1, $2::uuid, null, null, null, now())`,
						[POLICY_UNION_KEY, SCOPE_A.orgId],
					);
				});
				await withScopedTx(client, SCOPE_A, async () => {
					await client.query(
						`insert into object_kv(kind, key, org_id, ws_id, member_id, body_artifact_sha, updated_at)
						 values ('policy', $1, $2::uuid, $3::uuid, null, null, now())`,
						[POLICY_UNION_KEY, SCOPE_A.orgId, SCOPE_A.wsId],
					);
				});
				await withScopedTx(client, MEMBER_SCOPE_A, async () => {
					await client.query(
						`insert into object_kv(kind, key, org_id, ws_id, member_id, body_artifact_sha, updated_at)
						 values ('policy', $1, $2::uuid, $3::uuid, $4::uuid, null, now())`,
						[
							POLICY_UNION_KEY,
							SCOPE_A.orgId,
							SCOPE_A.wsId,
							MEMBER_SCOPE_A.memberId,
						],
					);
				});

				const wsRows = await withScopedTx(client, SCOPE_A, async () => {
					const result = await client.query<{ n: string }>(
						`select count(*)::text as n
						 from object_kv
						 where kind = 'policy'
						   and key = $1
						   and org_id = $2::uuid`,
						[POLICY_UNION_KEY, SCOPE_A.orgId],
					);
					return Number(result.rows[0]?.n ?? "0");
				});
				expect(wsRows).toBe(2);

				const memberRows = await withScopedTx(
					client,
					MEMBER_SCOPE_A,
					async () => {
						const result = await client.query<{ n: string }>(
							`select count(*)::text as n
							 from object_kv
							 where kind = 'policy'
							   and key = $1
							   and org_id = $2::uuid`,
							[POLICY_UNION_KEY, SCOPE_A.orgId],
						);
						return Number(result.rows[0]?.n ?? "0");
					},
				);
				expect(memberRows).toBe(3);

				await expect(
					withScopedTx(client, SCOPE_A, async () => {
						await client.query(
							`insert into object_kv(kind, key, org_id, ws_id, member_id, body_artifact_sha, updated_at)
							 values ('policy', $1, $2::uuid, null, null, null, now())`,
							[POLICY_STRICT_KEY, SCOPE_A.orgId],
						);
					}),
				).rejects.toThrowError(/row-level security/i);
			} finally {
				await client.query("reset role");
				client.release();
			await pool.end();
		}
	}, 30_000);
});
