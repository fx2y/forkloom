import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type DbosLiveProof = {
	workflowID: string;
	result: string;
	counts: {
		step1: number;
		step2: number;
	};
	crashMarker: string;
};

describe("run crash resume proof", () => {
	it("asserts DBOS live harness resumed with exactly-once step counts", () => {
		const proofPath = ".cache/test-int/dbos-live.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/dbos-live.json; run `MISE_EXPERIMENTAL=1 mise run test:int:dbos-runtime` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<DbosLiveProof>;

		expect(parsed.result).toBe("ok");
		expect(parsed.counts?.step1).toBe(1);
		expect(parsed.counts?.step2).toBe(1);
		expect(parsed.crashMarker).toBe("crashed");
		expect(typeof parsed.workflowID).toBe("string");
		expect(parsed.workflowID?.length).toBeGreaterThan(0);
	});
});
