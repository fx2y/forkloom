import { resolve } from "node:path";
import pg from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { PgArtifactRepo } from "../../apps/api/src/repo/postgres";
import { runWithTenantScope } from "../../apps/api/src/tenancy/scope-context";
import { executePromoteMemberToWs } from "../../apps/api/src/workflow/promote-member-to-ws";
import { executePromoteWsToOrg } from "../../apps/api/src/workflow/promote-ws-to-org";

const DATABASE_URL =
	process.env.DATABASE_URL ??
	process.env.DBOS_SYSTEM_DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/agentos";

const IDS = {
	orgId: "10000000-0000-0000-0000-000000000101",
	wsId: "10000000-0000-0000-0000-000000000102",
	memberId: "10000000-0000-0000-0000-000000000103",
};

const SHAS = {
	member: "9".repeat(64),
	ws: "8".repeat(64),
};

describe("tenancy promotion crash safety", () => {
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
				 values ($1, 'promotion-org')
				 on conflict (org_id) do nothing`,
				[IDS.orgId],
			);
			await pool.query(
				`insert into workspace(ws_id, org_id, name)
				 values ($1, $2, 'promotion-ws')
				 on conflict (ws_id) do nothing`,
				[IDS.wsId, IDS.orgId],
			);
			await pool.query(
				`insert into member(member_id, org_id, email)
				 values ($1, $2, 'promotion@example.com')
				 on conflict (member_id) do nothing`,
				[IDS.memberId, IDS.orgId],
			);
			for (const sha of Object.values(SHAS)) {
				await pool.query(
					`insert into artifact(sha256, uri, bytes, mime, type)
					 values ($1, $2, 1, 'application/json', 'json')
					 on conflict (sha256) do nothing`,
					[sha, `s3://artifacts/${sha}`],
				);
			}
			await pool.query(
				`delete from object_kv where org_id = $1 and kind = 'policy' and key = 'publish/default'`,
				[IDS.orgId],
			);
			await pool.query(
				`insert into object_kv(kind, key, org_id, ws_id, member_id, body_artifact_sha, updated_at)
				 values ('policy', 'publish/default', $1, $2, $3, $4, now())`,
				[IDS.orgId, IDS.wsId, IDS.memberId, SHAS.member],
			);
		} finally {
			await pool.end();
		}
	}, 45_000);

	it("is idempotent across crash-like interruption and preserves source rows", async () => {
		const stepsSeen: string[] = [];
		let crashInjected = false;
		await expect(
			runWithTenantScope(
				{
					orgId: IDS.orgId,
					wsId: IDS.wsId,
					memberId: IDS.memberId,
					writeTarget: "member",
				},
				() =>
					executePromoteMemberToWs(
						{
							orgId: IDS.orgId,
							wsId: IDS.wsId,
							memberId: IDS.memberId,
							kind: "policy",
							key: "publish/default",
						},
						{ databaseUrl: DATABASE_URL },
						{
							runStep: async (name, fn) => {
								stepsSeen.push(name);
								if (name === "copyProvenance" && !crashInjected) {
									crashInjected = true;
									throw new Error("simulated crash");
								}
								return fn();
							},
						},
					),
			),
		).rejects.toThrow("simulated crash");

		const recovered = await runWithTenantScope(
			{
				orgId: IDS.orgId,
				wsId: IDS.wsId,
				memberId: IDS.memberId,
				writeTarget: "member",
			},
			() =>
				executePromoteMemberToWs(
					{
						orgId: IDS.orgId,
						wsId: IDS.wsId,
						memberId: IDS.memberId,
						kind: "policy",
						key: "publish/default",
					},
					{ databaseUrl: DATABASE_URL },
					{ runStep: async (_name, fn) => fn() },
				),
		);
		expect(recovered).toEqual({ sha: SHAS.member });
		expect(stepsSeen).toContain("copyRef");

		const wsPromoted = await runWithTenantScope(
			{
				orgId: IDS.orgId,
				wsId: IDS.wsId,
				writeTarget: "ws",
			},
			() =>
				executePromoteWsToOrg(
					{
						orgId: IDS.orgId,
						wsId: IDS.wsId,
						kind: "policy",
						key: "publish/default",
					},
					{ databaseUrl: DATABASE_URL },
					{ runStep: async (_name, fn) => fn() },
				),
		);
		expect(wsPromoted).toEqual({ sha: SHAS.member });

		const pool = new pg.Pool({ connectionString: DATABASE_URL });
		try {
			const source = await pool.query<{ body_artifact_sha: string | null }>(
				`select body_artifact_sha from object_kv
				 where org_id = $1::uuid and ws_id = $2::uuid and member_id = $3::uuid
				   and kind = 'policy' and key = 'publish/default'`,
				[IDS.orgId, IDS.wsId, IDS.memberId],
			);
			expect(source.rows[0]?.body_artifact_sha).toBe(SHAS.member);

			const ws = await pool.query<{ body_artifact_sha: string | null }>(
				`select body_artifact_sha from object_kv
				 where org_id = $1::uuid and ws_id = $2::uuid and member_id is null
				   and kind = 'policy' and key = 'publish/default'`,
				[IDS.orgId, IDS.wsId],
			);
			expect(ws.rows[0]?.body_artifact_sha).toBe(SHAS.member);

			const org = await pool.query<{ body_artifact_sha: string | null }>(
				`select body_artifact_sha from object_kv
				 where org_id = $1::uuid and ws_id is null and member_id is null
				   and kind = 'policy' and key = 'publish/default'`,
				[IDS.orgId],
			);
			expect(org.rows[0]?.body_artifact_sha).toBe(SHAS.member);
		} finally {
			await pool.end();
		}
	}, 45_000);
});
