import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ChecklistIssue = {
	key: string;
	count: number;
};

type ChecklistReport = {
	status: "ok" | "fail";
	issues: ChecklistIssue[];
};

describe("truth checklist gate", () => {
	it("emits green checklist report", () => {
		const proofPath = ".cache/spec06/checklist-sql.report.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/spec06/checklist-sql.report.json; run `MISE_EXPERIMENTAL=1 mise run test:int:truth-checklist` first",
			);
		}
		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as ChecklistReport;
		expect(parsed.status).toBe("ok");
		expect(Array.isArray(parsed.issues)).toBe(true);
		expect(parsed.issues.map((issue) => issue.key)).toEqual([
			"missing_step_hashes",
			"missing_step_links",
			"missing_artifacts",
			"leaf_without_link",
		]);
		expect(parsed.issues.every((issue) => issue.count === 0)).toBe(true);
	});
});
