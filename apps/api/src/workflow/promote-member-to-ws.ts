import { DBOS } from "@dbos-inc/dbos-sdk";
import pg from "pg";

type PromoteMemberToWsStep = "loadSource" | "copyRef" | "copyProvenance";

type PromoteMemberToWsStepRunner = {
	runStep<T>(name: PromoteMemberToWsStep, fn: () => Promise<T>): Promise<T>;
};

const dbosStepRunner: PromoteMemberToWsStepRunner = {
	runStep<T>(name: PromoteMemberToWsStep, fn: () => Promise<T>): Promise<T> {
		return DBOS.runStep(fn, { name });
	},
};

export type PromoteMemberToWsInput = {
	orgId: string;
	wsId: string;
	memberId: string;
	kind: string;
	key: string;
};

export type PromoteMemberToWsOutput = {
	sha: string | null;
};

export type PromoteMemberToWsDeps = {
	databaseUrl: string;
	repo?: PromoteMemberToWsRepo | undefined;
};

type SourceRow = {
	body_artifact_sha: string | null;
};

type Queryable = {
	query<TRow = unknown>(
		text: string,
		values?: readonly unknown[],
	): Promise<{ rows: TRow[] }>;
};

type PromoteMemberToWsRepo = {
	loadSource(input: PromoteMemberToWsInput): Promise<SourceRow>;
	copyRef(input: PromoteMemberToWsInput, source: SourceRow): Promise<string | null>;
	copyProvenance(
		_input: PromoteMemberToWsInput,
		_sha: string | null,
	): Promise<void>;
};

const poolsByDatabaseUrl = new Map<string, pg.Pool>();

function getPool(databaseUrl: string): pg.Pool {
	const existing = poolsByDatabaseUrl.get(databaseUrl);
	if (existing) {
		return existing;
	}
	const created = new pg.Pool({ connectionString: databaseUrl });
	poolsByDatabaseUrl.set(databaseUrl, created);
	return created;
}

function createPgRepo(databaseUrl: string): PromoteMemberToWsRepo {
	const db: Queryable = getPool(databaseUrl);
	return {
		async loadSource(input: PromoteMemberToWsInput): Promise<SourceRow> {
			const result = await db.query<SourceRow>(
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
			const row = result.rows[0];
			if (!row) {
				throw new Error("member-scope source row not found");
			}
			return row;
		},
		async copyRef(
			input: PromoteMemberToWsInput,
			source: SourceRow,
		): Promise<string | null> {
			const result = await db.query<SourceRow>(
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
		},
		async copyProvenance(): Promise<void> {
			// Promotion preserves immutable provenance by re-pointing to the same CAS sha.
		},
	};
}

export async function executePromoteMemberToWs(
	input: PromoteMemberToWsInput,
	deps: PromoteMemberToWsDeps,
	steps: PromoteMemberToWsStepRunner = dbosStepRunner,
): Promise<PromoteMemberToWsOutput> {
	const repo = deps.repo ?? createPgRepo(deps.databaseUrl);
	const source = await steps.runStep("loadSource", () => repo.loadSource(input));
	const copied = await steps.runStep("copyRef", () => repo.copyRef(input, source));
	await steps.runStep("copyProvenance", async () => {
		await repo.copyProvenance(input, copied);
		return copied;
	});
	return { sha: copied };
}

let activeDeps: PromoteMemberToWsDeps | null = null;
let registeredWorkflow:
	| ((input: PromoteMemberToWsInput) => Promise<PromoteMemberToWsOutput>)
	| null = null;

export function registerPromoteMemberToWsWorkflow(
	deps: PromoteMemberToWsDeps,
): (input: PromoteMemberToWsInput) => Promise<PromoteMemberToWsOutput> {
	activeDeps = deps;
	if (!registeredWorkflow) {
		registeredWorkflow = DBOS.registerWorkflow(
			async (
				input: PromoteMemberToWsInput,
			): Promise<PromoteMemberToWsOutput> => {
				const currentDeps = activeDeps;
				if (!currentDeps) {
					throw new Error("PromoteMemberToWs deps are not registered");
				}
				return executePromoteMemberToWs(input, currentDeps, dbosStepRunner);
			},
			{
				name: "PromoteMemberToWsV1",
			},
		);
	}
	return registeredWorkflow;
}
