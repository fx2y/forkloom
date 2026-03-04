import { DBOS } from "@dbos-inc/dbos-sdk";
import pg from "pg";

type PromoteWsToOrgStep = "loadSource" | "copyRef" | "copyProvenance";

type PromoteWsToOrgStepRunner = {
	runStep<T>(name: PromoteWsToOrgStep, fn: () => Promise<T>): Promise<T>;
};

const dbosStepRunner: PromoteWsToOrgStepRunner = {
	runStep<T>(name: PromoteWsToOrgStep, fn: () => Promise<T>): Promise<T> {
		return DBOS.runStep(fn, { name });
	},
};

export type PromoteWsToOrgInput = {
	orgId: string;
	wsId: string;
	kind: string;
	key: string;
};

export type PromoteWsToOrgOutput = {
	sha: string | null;
};

export type PromoteWsToOrgDeps = {
	databaseUrl: string;
};

type SourceRow = {
	body_artifact_sha: string | null;
};

let pool: pg.Pool | null = null;

function getPool(databaseUrl: string): pg.Pool {
	if (!pool) {
		pool = new pg.Pool({ connectionString: databaseUrl });
	}
	return pool;
}

export async function executePromoteWsToOrg(
	input: PromoteWsToOrgInput,
	deps: PromoteWsToOrgDeps,
	steps: PromoteWsToOrgStepRunner = dbosStepRunner,
): Promise<PromoteWsToOrgOutput> {
	const db = getPool(deps.databaseUrl);
	const source = await steps.runStep("loadSource", async () => {
		const result = await db.query<SourceRow>(
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
		const row = result.rows[0];
		if (!row) {
			throw new Error("workspace-scope source row not found");
		}
		return row;
	});
	const copied = await steps.runStep("copyRef", async () => {
		const result = await db.query<SourceRow>(
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
	await steps.runStep("copyProvenance", async () => copied);
	return { sha: copied };
}

let activeDeps: PromoteWsToOrgDeps | null = null;
let registeredWorkflow:
	| ((input: PromoteWsToOrgInput) => Promise<PromoteWsToOrgOutput>)
	| null = null;

export function registerPromoteWsToOrgWorkflow(
	deps: PromoteWsToOrgDeps,
): (input: PromoteWsToOrgInput) => Promise<PromoteWsToOrgOutput> {
	activeDeps = deps;
	if (!registeredWorkflow) {
		registeredWorkflow = DBOS.registerWorkflow(
			async (input: PromoteWsToOrgInput): Promise<PromoteWsToOrgOutput> => {
				const currentDeps = activeDeps;
				if (!currentDeps) {
					throw new Error("PromoteWsToOrg deps are not registered");
				}
				return executePromoteWsToOrg(input, currentDeps, dbosStepRunner);
			},
			{
				name: "PromoteWsToOrgV1",
			},
		);
	}
	return registeredWorkflow;
}
