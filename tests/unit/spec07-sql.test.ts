import { describe, expect, it } from "vitest";
import {
	type DocChecklistReport,
	formatDocChecklistSummary,
	hasDocChecklistViolations,
} from "../../scripts/harness/spec07-sql";

describe("spec07 sql helpers", () => {
	it("reports violations when any doc checklist issue is non-zero", () => {
		const report: DocChecklistReport = {
			status: "fail",
			generatedAt: "2026-03-01T00:00:00.000Z",
			issues: [
				{ key: "no_done_parses", count: 0, rows: [] },
				{ key: "done_parse_without_doc_ingested", count: 1, rows: [] },
				{ key: "done_parse_without_usage", count: 0, rows: [] },
				{ key: "done_parse_without_chunks", count: 0, rows: [] },
				{ key: "done_chunk_without_spans", count: 0, rows: [] },
				{ key: "done_parse_missing_parse_aliases", count: 0, rows: [] },
				{ key: "done_parse_missing_raw_aliases", count: 0, rows: [] },
				{ key: "done_chunk_missing_chunk_aliases", count: 0, rows: [] },
				{ key: "done_chunk_missing_vector_row", count: 0, rows: [] },
				{ key: "done_chunk_missing_tsv", count: 0, rows: [] },
				{ key: "alias_without_artifact_blob", count: 0, rows: [] },
			],
		};
		expect(hasDocChecklistViolations(report)).toBe(true);
		expect(formatDocChecklistSummary(report)).toContain(
			"done_parse_without_doc_ingested=1",
		);
	});

	it("stays green when all doc checklist counts are zero", () => {
		const report: DocChecklistReport = {
			status: "ok",
			generatedAt: "2026-03-01T00:00:00.000Z",
			issues: [
				{ key: "no_done_parses", count: 0, rows: [] },
				{ key: "done_parse_without_doc_ingested", count: 0, rows: [] },
				{ key: "done_parse_without_usage", count: 0, rows: [] },
				{ key: "done_parse_without_chunks", count: 0, rows: [] },
				{ key: "done_chunk_without_spans", count: 0, rows: [] },
				{ key: "done_parse_missing_parse_aliases", count: 0, rows: [] },
				{ key: "done_parse_missing_raw_aliases", count: 0, rows: [] },
				{ key: "done_chunk_missing_chunk_aliases", count: 0, rows: [] },
				{ key: "done_chunk_missing_vector_row", count: 0, rows: [] },
				{ key: "done_chunk_missing_tsv", count: 0, rows: [] },
				{ key: "alias_without_artifact_blob", count: 0, rows: [] },
			],
		};
		expect(hasDocChecklistViolations(report)).toBe(false);
		expect(formatDocChecklistSummary(report)).toBe(
			"no_done_parses=0, done_parse_without_doc_ingested=0, done_parse_without_usage=0, done_parse_without_chunks=0, done_chunk_without_spans=0, done_parse_missing_parse_aliases=0, done_parse_missing_raw_aliases=0, done_chunk_missing_chunk_aliases=0, done_chunk_missing_vector_row=0, done_chunk_missing_tsv=0, alias_without_artifact_blob=0",
		);
	});
});
