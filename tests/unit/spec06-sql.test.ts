import { describe, expect, it } from "vitest";
import {
	type TruthChecklistReport,
	formatTruthChecklistSummary,
	hasTruthChecklistViolations,
} from "../../scripts/harness/spec06-sql";

describe("spec06 sql helpers", () => {
	it("reports violations from checklist rows", () => {
		const report: TruthChecklistReport = {
			status: "fail",
			generatedAt: "2026-03-01T00:00:00.000Z",
			issues: [
				{ key: "missing_step_hashes", count: 1, rows: [{ run_id: "r1" }] },
				{ key: "missing_step_links", count: 0, rows: [] },
				{ key: "missing_step_payloads", count: 0, rows: [] },
				{ key: "missing_artifacts", count: 0, rows: [] },
				{ key: "leaf_without_link", count: 0, rows: [] },
				{ key: "dead_command_without_step", count: 0, rows: [] },
			],
		};

		expect(hasTruthChecklistViolations(report)).toBe(true);
		expect(formatTruthChecklistSummary(report)).toContain(
			"missing_step_hashes=1",
		);
	});

	it("stays green when all issue counts are zero", () => {
		const report: TruthChecklistReport = {
			status: "ok",
			generatedAt: "2026-03-01T00:00:00.000Z",
			issues: [
				{ key: "missing_step_hashes", count: 0, rows: [] },
				{ key: "missing_step_links", count: 0, rows: [] },
				{ key: "missing_step_payloads", count: 0, rows: [] },
				{ key: "missing_artifacts", count: 0, rows: [] },
				{ key: "leaf_without_link", count: 0, rows: [] },
				{ key: "dead_command_without_step", count: 0, rows: [] },
			],
		};

		expect(hasTruthChecklistViolations(report)).toBe(false);
		expect(formatTruthChecklistSummary(report)).toBe(
			"missing_step_hashes=0, missing_step_links=0, missing_step_payloads=0, missing_artifacts=0, leaf_without_link=0, dead_command_without_step=0",
		);
	});
});
