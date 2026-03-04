import pg from "pg";
import { getTenantScope, withScopeTx } from "../http/scope";

type Queryable = {
	query<TRow = unknown>(
		text: string,
		values?: readonly unknown[],
	): Promise<{ rows: TRow[] }>;
};

type PoolClientLike = Queryable & {
	release(): void;
};

type PoolLike = Queryable & {
	connect(): Promise<PoolClientLike>;
};

export type PromotionSourceRow = {
	body_artifact_sha: string | null;
};

export type MemberSourceInput = {
	orgId: string;
	wsId: string;
	memberId: string;
	kind: string;
	key: string;
};

export type WsSourceInput = {
	orgId: string;
	wsId: string;
	kind: string;
	key: string;
};

export type PromotionScopedRepo = {
	loadMemberSource(input: MemberSourceInput): Promise<PromotionSourceRow | null>;
	copyMemberToWs(
		input: MemberSourceInput,
		source: PromotionSourceRow,
	): Promise<string | null>;
	loadWsSource(input: WsSourceInput): Promise<PromotionSourceRow | null>;
	copyWsToOrg(
		input: WsSourceInput,
		source: PromotionSourceRow,
	): Promise<string | null>;
};

const poolsByDatabaseUrl = new Map<string, pg.Pool>();

function getPool(databaseUrl: string): PoolLike {
	const existing = poolsByDatabaseUrl.get(databaseUrl);
	if (existing) {
		return existing;
	}
	const created = new pg.Pool({ connectionString: databaseUrl });
	poolsByDatabaseUrl.set(databaseUrl, created);
	return created;
}

async function withTenantScope<T>(
	pool: PoolLike,
	fn: (queryable: Queryable) => Promise<T>,
): Promise<T> {
	const scope = getTenantScope();
	if (!scope) {
		return fn(pool);
	}
	const client = await pool.connect();
	try {
		return await withScopeTx(client, scope, () => fn(client));
	} finally {
		client.release();
	}
}

export function createPromotionScopedRepo(
	databaseUrl: string,
): PromotionScopedRepo {
	const pool = getPool(databaseUrl);
	return {
		async loadMemberSource(
			input: MemberSourceInput,
		): Promise<PromotionSourceRow | null> {
			return withTenantScope(pool, async (db) => {
				const result = await db.query<PromotionSourceRow>(
					`select body_artifact_sha
					 from object_kv
					 where org_id = $1::uuid
					   and ws_id = $2::uuid
					   and member_id = $3::uuid
					   and kind = $4
					   and key = $5
					 order by updated_at desc
					 limit 1`,
					[input.orgId, input.wsId, input.memberId, input.kind, input.key],
				);
				return result.rows[0] ?? null;
			});
		},
		async copyMemberToWs(
			input: MemberSourceInput,
			source: PromotionSourceRow,
		): Promise<string | null> {
			return withTenantScope(pool, async (db) => {
				const result = await db.query<PromotionSourceRow>(
					`insert into object_kv(
					   kind, key, org_id, ws_id, member_id, body_artifact_sha, updated_at
					 )
					 values ($1, $2, $3::uuid, $4::uuid, null, $5, now())
					 on conflict (kind, key, org_id, ws_id, member_id) do update
					 set body_artifact_sha = excluded.body_artifact_sha,
					     updated_at = excluded.updated_at
					 returning body_artifact_sha`,
					[
						input.kind,
						input.key,
						input.orgId,
						input.wsId,
						source.body_artifact_sha,
					],
				);
				return result.rows[0]?.body_artifact_sha ?? null;
			});
		},
		async loadWsSource(input: WsSourceInput): Promise<PromotionSourceRow | null> {
			return withTenantScope(pool, async (db) => {
				const result = await db.query<PromotionSourceRow>(
					`select body_artifact_sha
					 from object_kv
					 where org_id = $1::uuid
					   and ws_id = $2::uuid
					   and member_id is null
					   and kind = $3
					   and key = $4
					 order by updated_at desc
					 limit 1`,
					[input.orgId, input.wsId, input.kind, input.key],
				);
				return result.rows[0] ?? null;
			});
		},
		async copyWsToOrg(
			input: WsSourceInput,
			source: PromotionSourceRow,
		): Promise<string | null> {
			return withTenantScope(pool, async (db) => {
				const result = await db.query<PromotionSourceRow>(
					`insert into object_kv(
					   kind, key, org_id, ws_id, member_id, body_artifact_sha, updated_at
					 )
					 values ($1, $2, $3::uuid, null, null, $4, now())
					 on conflict (kind, key, org_id, ws_id, member_id) do update
					 set body_artifact_sha = excluded.body_artifact_sha,
					     updated_at = excluded.updated_at
					 returning body_artifact_sha`,
					[input.kind, input.key, input.orgId, source.body_artifact_sha],
				);
				return result.rows[0]?.body_artifact_sha ?? null;
			});
		},
	};
}
