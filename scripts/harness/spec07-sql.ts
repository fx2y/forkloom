import type pg from "pg";
import { queryRows } from "./live-support";

export type DocChecklistIssueKey =
	| "no_done_parses"
	| "done_parse_without_doc_ingested"
	| "done_parse_without_usage"
	| "done_parse_without_chunks"
	| "done_chunk_without_spans"
	| "done_parse_missing_parse_aliases"
	| "done_parse_missing_raw_aliases"
	| "done_chunk_missing_chunk_aliases"
	| "done_chunk_missing_vector_row"
	| "done_chunk_missing_tsv"
	| "alias_without_artifact_blob";

export type DocChecklistIssue = {
	key: DocChecklistIssueKey;
	count: number;
	rows: Record<string, unknown>[];
};

export type DocChecklistReport = {
	status: "ok" | "fail";
	generatedAt: string;
	issues: DocChecklistIssue[];
};

type QueryDef = {
	key: DocChecklistIssueKey;
	text: string;
};

const DOC_CHECKLIST_QUERIES: readonly QueryDef[] = [
	{
		key: "no_done_parses",
		text: `
			select 'no_done_parses' as issue
			where not exists (
				select 1 from parses where status = 'done'
			)
		`,
	},
	{
		key: "done_parse_without_doc_ingested",
		text: `
			select p.parse_id, p.doc_sha
			from parses p
			left join doc_ingested di on di.parse_id = p.parse_id
			where p.status = 'done'
			  and di.parse_id is null
			order by p.parse_id
		`,
	},
	{
		key: "done_parse_without_usage",
		text: `
			select p.parse_id, p.doc_sha
			from parses p
			left join ocr_usage u on u.parse_id = p.parse_id
			where p.status = 'done'
			  and u.parse_id is null
			order by p.parse_id
		`,
	},
	{
		key: "done_parse_without_chunks",
		text: `
			select p.parse_id, p.doc_sha
			from parses p
			left join chunks c on c.parse_id = p.parse_id
			where p.status = 'done'
			group by p.parse_id, p.doc_sha
			having count(c.chunk_id) = 0
			order by p.parse_id
		`,
	},
	{
		key: "done_chunk_without_spans",
		text: `
			select c.parse_id, c.chunk_id
			from chunks c
			join parses p on p.parse_id = c.parse_id
			left join spans s on s.chunk_id = c.chunk_id
			where p.status = 'done'
			group by c.parse_id, c.chunk_id
			having count(s.span_id) = 0
			order by c.parse_id, c.chunk_id
		`,
	},
	{
		key: "done_parse_missing_parse_aliases",
		text: `
			select p.parse_id
			from parses p
			left join artifact_alias md
			  on md.alias = concat('parse/', p.parse_id, '.md')
			left join artifact_alias js
			  on js.alias = concat('parse/', p.parse_id, '.json')
			where p.status = 'done'
			  and (md.sha256 is null or js.sha256 is null)
			order by p.parse_id
		`,
	},
	{
		key: "done_parse_missing_raw_aliases",
		text: `
			select p.parse_id
			from parses p
			left join artifact_alias md_raw
			  on md_raw.alias = concat('parse/', p.parse_id, '.md.raw')
			left join artifact_alias js_raw
			  on js_raw.alias = concat('parse/', p.parse_id, '.json.raw')
			where p.status = 'done'
			  and (md_raw.sha256 is null or js_raw.sha256 is null)
			order by p.parse_id
		`,
	},
	{
		key: "done_chunk_missing_chunk_aliases",
		text: `
			select c.parse_id, c.chunk_id
			from chunks c
			join parses p on p.parse_id = c.parse_id
			left join artifact_alias md
			  on md.alias = concat('chunks/', c.chunk_id, '.md')
			left join artifact_alias js
			  on js.alias = concat('chunks/', c.chunk_id, '.json')
			where p.status = 'done'
			  and (md.sha256 is null or js.sha256 is null)
			order by c.parse_id, c.chunk_id
		`,
	},
	{
		key: "done_chunk_missing_vector_row",
		text: `
			select c.parse_id, c.chunk_id
			from chunks c
			join parses p on p.parse_id = c.parse_id
			left join chunk_vec cv on cv.chunk_id = c.chunk_id
			where p.status = 'done'
			  and cv.chunk_id is null
			order by c.parse_id, c.chunk_id
		`,
	},
	{
		key: "done_chunk_missing_tsv",
		text: `
			select c.parse_id, c.chunk_id
			from chunks c
			join parses p on p.parse_id = c.parse_id
			where p.status = 'done'
			  and c.tsv is null
			order by c.parse_id, c.chunk_id
		`,
	},
	{
		key: "alias_without_artifact_blob",
		text: `
			select a.alias, a.sha256
			from artifact_alias a
			left join artifact blob on blob.sha256 = a.sha256
			where (
				a.alias like 'parse/%'
				or a.alias like 'chunks/%'
			)
			  and blob.sha256 is null
			order by a.alias
		`,
	},
];

const MAX_ROWS_PER_ISSUE = 25;

function toJsonRecord(row: pg.QueryResultRow): Record<string, unknown> {
	return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

async function runChecklistQuery(query: QueryDef): Promise<DocChecklistIssue> {
	const rows = await queryRows(query.text);
	return {
		key: query.key,
		count: rows.length,
		rows: rows.slice(0, MAX_ROWS_PER_ISSUE).map(toJsonRecord),
	};
}

export async function collectDocChecklistReport(): Promise<DocChecklistReport> {
	const issues = await Promise.all(
		DOC_CHECKLIST_QUERIES.map(runChecklistQuery),
	);
	return {
		status: issues.some((issue) => issue.count > 0) ? "fail" : "ok",
		generatedAt: new Date().toISOString(),
		issues,
	};
}

export function hasDocChecklistViolations(report: DocChecklistReport): boolean {
	return report.issues.some((issue) => issue.count > 0);
}

export function formatDocChecklistSummary(report: DocChecklistReport): string {
	return report.issues.map((issue) => `${issue.key}=${issue.count}`).join(", ");
}
