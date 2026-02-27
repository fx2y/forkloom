import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type FunctionalProof = {
	runId: string;
	created: boolean;
	runStartedLatencyMs: number;
	runState: {
		status: string;
		piSessionId?: string;
		piSessionFile?: string;
		artifacts: Array<{ sha256: string }>;
	};
	runDone: {
		resultText: string;
		artifacts: string[];
	};
	sessionArtifactSha256: string;
};

describe("run functional live proof", () => {
	it("asserts run_started latency and run_done payload from live harness", () => {
		const proofPath = ".cache/test-int/run-functional.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/run-functional.json; run `MISE_EXPERIMENTAL=1 mise run test:int:run-functional` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<FunctionalProof>;

		expect(typeof parsed.runId).toBe("string");
		expect(parsed.created).toBe(true);
		expect(parsed.runStartedLatencyMs).toBeLessThanOrEqual(200);
		expect(parsed.runState?.status).toBe("done");
		expect(typeof parsed.runState?.piSessionId).toBe("string");
		expect(typeof parsed.runState?.piSessionFile).toBe("string");
		expect(parsed.runDone?.resultText.length).toBeGreaterThan(0);
		expect(parsed.runDone?.artifacts).toContain(parsed.sessionArtifactSha256);
		expect(
			parsed.runState?.artifacts.some(
				(artifact) => artifact.sha256 === parsed.sessionArtifactSha256,
			),
		).toBe(true);
	});
});
