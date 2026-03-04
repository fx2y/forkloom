import { resolve } from "node:path";
import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { PgDocRepo } from "../../apps/api/src/doc";
import { PgArtifactRepo } from "../../apps/api/src/repo/postgres";
import { runWithTenantScope } from "../../apps/api/src/tenancy/scope-context";

const DATABASE_URL =
	process.env.DATABASE_URL ??
	process.env.DBOS_SYSTEM_DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/agentos";

const IDS = {
	orgId: "10000000-0000-0000-0000-000000000001",
	wsId: "10000000-0000-0000-0000-000000000002",
	memberId: "10000000-0000-0000-0000-000000000003",
};

const SHAS = {
	org: "1".repeat(64),
	ws: "2".repeat(64),
	member: "3".repeat(64),
};

describe("tenancy shadowing", () => {
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
				`insert into org(org_id, name)
				 values ($1, 'shadow-org')
				 on conflict (org_id) do nothing`,
				[IDS.orgId],
			);
			await pool.query(
				`insert into workspace(ws_id, org_id, name)
				 values ($1, $2, 'shadow-ws')
				 on conflict (ws_id) do nothing`,
				[IDS.wsId, IDS.orgId],
			);
			await pool.query(
				`insert into member(member_id, org_id, email)
				 values ($1, $2, 'shadow@example.com')
				 on conflict (member_id) do nothing`,
				[IDS.memberId, IDS.orgId],
			);
			for (const sha of Object.values(SHAS)) {
				await pool.query(
					`insert into artifact(sha256, uri, bytes, mime, type)
					 values ($1, $2, 1, 'text/plain', 'raw')
					 on conflict (sha256) do nothing`,
					[sha, `s3://artifacts/${sha}`],
				);
			}
			await pool.query(
				`delete from object_kv where org_id = $1 and kind = 'policy' and key = 'policy/default'`,
				[IDS.orgId],
			);
			await pool.query(
				`insert into object_kv(kind, key, org_id, ws_id, member_id, body_artifact_sha, updated_at)
				 values
				   ('policy', 'policy/default', $1, null, null, $2, now() - interval '2 minutes'),
				   ('policy', 'policy/default', $1, $3, null, $4, now() - interval '1 minutes'),
				   ('policy', 'policy/default', $1, $3, $5, $6, now())`,
				[IDS.orgId, SHAS.org, IDS.wsId, SHAS.ws, IDS.memberId, SHAS.member],
			);
		} finally {
			await pool.end();
		}
	}, 30_000);

	it("selects member>ws>org winners deterministically", async () => {
		const repo = new PgDocRepo({ databaseUrl: DATABASE_URL });
		try {
			const memberWins = await runWithTenantScope(
				{
					orgId: IDS.orgId,
					wsId: IDS.wsId,
					memberId: IDS.memberId,
					writeTarget: "member",
				},
				() =>
					repo.listObjectKvWinners({
						kinds: ["policy"],
						keys: ["policy/default"],
					}),
			);
			expect(memberWins[0]?.bodyArtifactSha).toBe(SHAS.member);
			expect(memberWins[0]?.scopeRank).toBe(3);

			const wsWins = await runWithTenantScope(
				{
					orgId: IDS.orgId,
					wsId: IDS.wsId,
					writeTarget: "ws",
				},
				() =>
					repo.listObjectKvWinners({
						kinds: ["policy"],
						keys: ["policy/default"],
					}),
			);
			expect(wsWins[0]?.bodyArtifactSha).toBe(SHAS.ws);
			expect(wsWins[0]?.scopeRank).toBe(2);

			const orgWins = await runWithTenantScope(
				{
					orgId: IDS.orgId,
					writeTarget: "org",
				},
				() =>
					repo.listObjectKvWinners({
						kinds: ["policy"],
						keys: ["policy/default"],
					}),
			);
			expect(orgWins[0]?.bodyArtifactSha).toBe(SHAS.org);
			expect(orgWins[0]?.scopeRank).toBe(1);
		} finally {
			await repo.close();
		}
	}, 30_000);
});
