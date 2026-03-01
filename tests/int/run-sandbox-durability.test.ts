import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type RunSandboxDurabilityProof = {
	workflowID: string;
	runId: string;
	counts: Record<string, number>;
	crashMarker: string;
};

describe("run sandbox durability proof", () => {
	it("asserts DBOS resumed the interactive sandbox workflow without duplicate completed steps", () => {
		const proofPath = ".cache/test-int/run-sandbox-durability.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/run-sandbox-durability.json; run `MISE_EXPERIMENTAL=1 mise run test:int:run-sandbox-durability` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<RunSandboxDurabilityProof>;

		expect(typeof parsed.workflowID).toBe("string");
		expect(typeof parsed.runId).toBe("string");
		expect(parsed.crashMarker).toBe("crashed");
		expect(parsed.counts?.acquire_lease).toBe(1);
		expect(parsed.counts?.claim_command).toBe(1);
		expect(parsed.counts?.load_run).toBe(1);
		expect(parsed.counts?.load_sandbox).toBe(1);
		expect(parsed.counts?.ensure_sandbox).toBe(1);
		expect(parsed.counts?.read_attachment).toBe(1);
		expect(parsed.counts?.create_pi).toBe(1);
		expect(parsed.counts?.run_started).toBe(1);
		expect(parsed.counts?.prompt).toBe(1);
		expect(parsed.counts?.pi_event).toBe(1);
		expect(parsed.counts?.persist_session).toBe(1);
		expect(parsed.counts?.snapshot).toBe(1);
		expect(parsed.counts?.persist_exec).toBe(1);
		expect(parsed.counts?.record_step_ledger).toBe(1);
		expect(parsed.counts?.artifact_pi_session_jsonl).toBe(1);
		expect(parsed.counts?.artifact_workspace_snapshot).toBe(1);
		expect(parsed.counts?.release_lease).toBe(1);
	});
});
