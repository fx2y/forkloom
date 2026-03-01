import type pg from "pg";
import { queryRows } from "./live-support";

export type TruthChecklistIssueKey =
	| "missing_step_hashes"
	| "missing_step_links"
	| "missing_artifacts"
	| "leaf_without_link";

export type TruthChecklistIssue = {
	key: TruthChecklistIssueKey;
	count: number;
	rows: Record<string, unknown>[];
};

export type TruthChecklistReport = {
	status: "ok" | "fail";
	generatedAt: string;
	issues: TruthChecklistIssue[];
};

type QueryDef = {
	key: TruthChecklistIssueKey;
	text: string;
};

const CHECKLIST_QUERIES: readonly QueryDef[] = [
	{
		key: "missing_step_hashes",
		text: `
			select
				run_id,
				step_name,
				attempt
			from steps
			where ended_at is not null
			  and (
			  	in_hash is null
			  	or in_hash = ''
			  	or out_hash is null
			  	or out_hash = ''
			  )
			order by run_id, step_name, attempt
		`,
	},
	{
		key: "missing_step_links",
		text: `
			select
				s.run_id,
				s.step_name,
				s.attempt
			from steps s
			left join links l
			  on l.run_id = s.run_id
			 and l.step_name = s.step_name
			 and l.attempt = s.attempt
			where s.ended_at is not null
			  and l.run_id is null
			order by s.run_id, s.step_name, s.attempt
		`,
	},
	{
		key: "missing_artifacts",
		text: `
			select
				l.run_id,
				l.step_name,
				l.attempt,
				art.sha256 as missing_sha
			from links l
			cross join lateral unnest(l.artifact_shas) as art(sha256)
			left join artifact a
			  on a.sha256 = art.sha256
			where a.sha256 is null
			order by l.run_id, l.step_name, l.attempt, art.sha256
		`,
	},
	{
		key: "leaf_without_link",
		text: `
			select
				si.run_id,
				si.leaf_id
			from sessions_index si
			where si.leaf_id is not null
			  and not exists (
			  	select 1
			  	from links l
			  	where l.run_id = si.run_id
			  	  and si.leaf_id = any(l.session_entry_ids)
			  )
			order by si.run_id
		`,
	},
];

const MAX_ROWS_PER_ISSUE = 25;

function toJsonRecord(row: pg.QueryResultRow): Record<string, unknown> {
	return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

async function runChecklistQuery(
	query: QueryDef,
): Promise<TruthChecklistIssue> {
	const rows = await queryRows(query.text);
	return {
		key: query.key,
		count: rows.length,
		rows: rows.slice(0, MAX_ROWS_PER_ISSUE).map(toJsonRecord),
	};
}

export async function collectTruthChecklistReport(): Promise<TruthChecklistReport> {
	const issues = await Promise.all(CHECKLIST_QUERIES.map(runChecklistQuery));
	return {
		status: issues.some((issue) => issue.count > 0) ? "fail" : "ok",
		generatedAt: new Date().toISOString(),
		issues,
	};
}

export function hasTruthChecklistViolations(
	report: TruthChecklistReport,
): boolean {
	return report.issues.some((issue) => issue.count > 0);
}

export function formatTruthChecklistSummary(
	report: TruthChecklistReport,
): string {
	return report.issues.map((issue) => `${issue.key}=${issue.count}`).join(", ");
}

export type OpsRecentRun = {
	run_id: string;
	status: string;
	created_at: string;
	updated_at: string;
};

export type OpsStepDriftRow = {
	run_id: string;
	step_name: string;
	attempt: number;
	in_hash: string;
	out_hash: string | null;
	artifact_shas: string[];
	session_entry_ids: string[];
	started_at: string;
	ended_at: string | null;
};

export type OpsSqlPackReport = {
	status: "ok";
	generatedAt: string;
	targetRunId: string | null;
	recentRuns: OpsRecentRun[];
	driftRows: OpsStepDriftRow[];
};

const RECENT_RUNS_SQL = `
	select
		run_id,
		status,
		created_at::text as created_at,
		updated_at::text as updated_at
	from runs
	order by created_at desc
	limit 50
`;

const STEP_DRIFT_SQL = `
	select
		s.run_id,
		s.step_name,
		s.attempt,
		s.in_hash,
		s.out_hash,
		l.artifact_shas,
		l.session_entry_ids,
		s.started_at::text as started_at,
		s.ended_at::text as ended_at
	from steps s
	join links l
	  on l.run_id = s.run_id
	 and l.step_name = s.step_name
	 and l.attempt = s.attempt
	where s.run_id = $1
	order by s.started_at, s.step_name, s.attempt
`;

export async function collectOpsSqlPack(input: {
	runId?: string;
}): Promise<OpsSqlPackReport> {
	const recentRows = await queryRows<OpsRecentRun>(RECENT_RUNS_SQL);
	const targetRunId = input.runId ?? recentRows[0]?.run_id ?? null;
	const driftRows = targetRunId
		? await queryRows<OpsStepDriftRow>(STEP_DRIFT_SQL, [targetRunId])
		: [];
	return {
		status: "ok",
		generatedAt: new Date().toISOString(),
		targetRunId,
		recentRuns: recentRows,
		driftRows,
	};
}
