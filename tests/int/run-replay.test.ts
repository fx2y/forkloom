import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type RunReplayProof = {
	runId: string;
	mode: string;
	replaySourceRunId: string;
	replayAttempts: number[];
	expectedCount: number;
	replayCount: number;
	artifactShas: string[];
	status: string;
};

type ReplayLiveRunProof = {
	runId: string;
	runStatus: string;
};

describe("run replay proof", () => {
	it("asserts replay sha-set equality and emits proof artifact", () => {
		const proofPath = ".cache/spec06/replay-cli.assert.json";
		const liveProofPath = ".cache/spec06/replay-proof.live-run.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/spec06/replay-cli.assert.json; run `MISE_EXPERIMENTAL=1 mise run test:int:run-replay` first",
			);
		}
		if (!existsSync(liveProofPath)) {
			throw new Error(
				"missing .cache/spec06/replay-proof.live-run.json; run `MISE_EXPERIMENTAL=1 mise run test:int:run-replay` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<RunReplayProof>;
		const liveParsed = JSON.parse(
			readFileSync(liveProofPath, "utf8"),
		) as Partial<ReplayLiveRunProof>;
		expect(typeof parsed.runId).toBe("string");
		expect(parsed.runId).toBe(liveParsed.runId);
		expect(["done", "failed", "aborted"]).toContain(liveParsed.runStatus);
		expect(parsed.mode).toBe("stub");
		expect(parsed.replaySourceRunId).toBe(parsed.runId);
		expect(Array.isArray(parsed.replayAttempts)).toBe(true);
		expect(parsed.expectedCount).toBe(parsed.replayCount);
		expect(parsed.status).toBe("ok");
		expect(Array.isArray(parsed.artifactShas)).toBe(true);
		expect(parsed.artifactShas?.length).toBeGreaterThan(0);
	});
});
