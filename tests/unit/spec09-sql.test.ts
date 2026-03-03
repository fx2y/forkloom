import { describe, expect, it } from "vitest";
import {
	type Spec09ChecklistReport,
	formatSpec09ChecklistSummary,
	hasSpec09ChecklistViolations,
} from "../../scripts/harness/spec09-sql";

describe("spec09 sql helpers", () => {
	it("reports violations when req/task closure has gaps", () => {
		const report: Spec09ChecklistReport = {
			status: "fail",
			generatedAt: "2026-03-03T00:00:00.000Z",
			reqFullCoverMiss: 1,
			tasksDone: 10,
			tasksTotal: 12,
			taskAllDone: false,
			requiredTaskMissing: ["T850"],
			requiredTaskNotDone: ["T840"],
			c7ValidateProofOk: false,
			c7SmokeProofOk: false,
			proofMatrixOk: false,
		};
		expect(hasSpec09ChecklistViolations(report)).toBe(true);
		expect(formatSpec09ChecklistSummary(report)).toBe(
			"req_full_cover_miss=1, task_done=10, task_total=12, task_all_done=0, required_missing=1, required_not_done=1, c7_validate_ok=0, c7_smoke_ok=0, proof_matrix_ok=0",
		);
	});

	it("stays green when closure latch is fully satisfied", () => {
		const report: Spec09ChecklistReport = {
			status: "ok",
			generatedAt: "2026-03-03T00:00:00.000Z",
			reqFullCoverMiss: 0,
			tasksDone: 12,
			tasksTotal: 12,
			taskAllDone: true,
			requiredTaskMissing: [],
			requiredTaskNotDone: [],
			c7ValidateProofOk: true,
			c7SmokeProofOk: true,
			proofMatrixOk: true,
		};
		expect(hasSpec09ChecklistViolations(report)).toBe(false);
		expect(formatSpec09ChecklistSummary(report)).toBe(
			"req_full_cover_miss=0, task_done=12, task_total=12, task_all_done=1, required_missing=0, required_not_done=0, c7_validate_ok=1, c7_smoke_ok=1, proof_matrix_ok=1",
		);
	});
});
