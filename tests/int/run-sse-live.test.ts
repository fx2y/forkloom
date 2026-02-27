import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type SseProof = {
	runId: string;
	cursor: number;
	prefixSeqs: number[];
	replaySeqs: number[];
	secondTabSeqs: number[];
	runState: {
		status: string;
	};
};

describe("run SSE live proof", () => {
	it("asserts two-tab replay resumes from Last-Event-ID without dupes", () => {
		const proofPath = ".cache/test-int/run-sse.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/run-sse.json; run `MISE_EXPERIMENTAL=1 mise run test:int:run-sse` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<SseProof>;

		expect(typeof parsed.runId).toBe("string");
		expect(parsed.runState?.status).toBe("done");
		expect(parsed.cursor).toBeGreaterThan(0);
		expect(parsed.replaySeqs?.[0]).toBeGreaterThan(parsed.cursor ?? 0);
		expect(parsed.prefixSeqs?.concat(parsed.replaySeqs ?? [])).toEqual(
			parsed.secondTabSeqs,
		);
		expect(new Set(parsed.secondTabSeqs ?? []).size).toBe(
			parsed.secondTabSeqs?.length ?? 0,
		);
	});
});
