import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type RunOnceProof = {
	workflowID: string;
	runId: string;
	counts: Record<string, number>;
	crashMarker: string;
};

describe("runonce DBOS live proof", () => {
	it("asserts RunOnce resumes after crash without rerunning completed steps", () => {
		const proofPath = ".cache/test-int/runonce-live.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/runonce-live.json; run `MISE_EXPERIMENTAL=1 mise run test:int:run-durability` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<RunOnceProof>;

		expect(parsed.crashMarker).toBe("crashed");
		expect(typeof parsed.workflowID).toBe("string");
		expect(parsed.workflowID).toBe(parsed.runId);
		for (const key of [
			"run_started",
			"link_input_attachment",
			"artifact_input_attachment",
			"start_pi",
			"prompt",
			"pi_event",
			"persist_session",
			"link_pi_session_jsonl",
			"artifact_pi_session_jsonl",
			"run_done",
		]) {
			expect(parsed.counts?.[key]).toBe(1);
		}
	});
});
