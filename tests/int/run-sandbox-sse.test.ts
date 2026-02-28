import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type RunSandboxSseProof = {
	runId: string;
	cursor: number;
	prefixSeqs: number[];
	replaySeqs: number[];
	replayKinds: string[];
	stayedOpenAfterTerminal: boolean;
};

describe("run sandbox SSE proof", () => {
	it("asserts interactive replay stays open after terminal frames and replays without dupes", () => {
		const proofPath = ".cache/test-int/run-sandbox-sse.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/run-sandbox-sse.json; run `MISE_EXPERIMENTAL=1 mise run test:int:run-sandbox-sse` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<RunSandboxSseProof>;

		expect(typeof parsed.runId).toBe("string");
		expect(parsed.cursor).toBeGreaterThan(0);
		expect(parsed.prefixSeqs).toEqual([1, 2]);
		expect(parsed.replaySeqs).toEqual([3, 4, 5]);
		expect(parsed.replayKinds).toEqual([
			"run_started",
			"workspace_updated",
			"run_aborted",
		]);
		expect(parsed.stayedOpenAfterTerminal).toBe(true);
	});
});
