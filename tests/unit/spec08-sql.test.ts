import { describe, expect, it } from "vitest";
import {
	type Spec08ChecklistReport,
	formatSpec08ChecklistSummary,
	hasSpec08ChecklistViolations,
} from "../../scripts/harness/spec08-sql";

describe("spec08 sql helpers", () => {
	it("reports violations when req/task closure has gaps", () => {
		const report: Spec08ChecklistReport = {
			status: "fail",
			generatedAt: "2026-03-02T00:00:00.000Z",
			reqFullCoverMiss: 1,
			tasksDone: 10,
			tasksTotal: 15,
			taskAllDone: false,
			requiredTaskMissing: ["T850"],
			requiredTaskNotDone: ["T840"],
			skillsValidateProofOk: false,
			packsDynamicProofOk: false,
			skillLiveProofOk: false,
		};
		expect(hasSpec08ChecklistViolations(report)).toBe(true);
		expect(formatSpec08ChecklistSummary(report)).toBe(
			"req_full_cover_miss=1, task_done=10, task_total=15, task_all_done=0, required_missing=1, required_not_done=1, validate_proof_ok=0, pack_proof_ok=0, skill_live_ok=0",
		);
	});

	it("stays green when closure latch is fully satisfied", () => {
		const report: Spec08ChecklistReport = {
			status: "ok",
			generatedAt: "2026-03-02T00:00:00.000Z",
			reqFullCoverMiss: 0,
			tasksDone: 15,
			tasksTotal: 15,
			taskAllDone: true,
			requiredTaskMissing: [],
			requiredTaskNotDone: [],
			skillsValidateProofOk: true,
			packsDynamicProofOk: true,
			skillLiveProofOk: true,
		};
		expect(hasSpec08ChecklistViolations(report)).toBe(false);
		expect(formatSpec08ChecklistSummary(report)).toBe(
			"req_full_cover_miss=0, task_done=15, task_total=15, task_all_done=1, required_missing=0, required_not_done=0, validate_proof_ok=1, pack_proof_ok=1, skill_live_ok=1",
		);
	});
});
