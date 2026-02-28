import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ActorSseProof = {
	actorId: string;
	cursor: number;
	prefixSeqs: number[];
	replaySeqs: number[];
	secondTabSeqs: number[];
	actorState: {
		status: string;
	};
};

describe("actor SSE live proof", () => {
	it("asserts two-tab replay resumes from Last-Event-ID without dupes", () => {
		const proofPath = ".cache/test-int/actor-sse.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/actor-sse.json; run `MISE_EXPERIMENTAL=1 mise run test:int:actor-sse` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<ActorSseProof>;

		expect(typeof parsed.actorId).toBe("string");
		expect(parsed.cursor).toBeGreaterThan(0);
		expect(parsed.actorState?.status).toBe("idle");
		expect(parsed.replaySeqs?.[0]).toBeGreaterThan(parsed.cursor ?? 0);
		expect(parsed.prefixSeqs?.concat(parsed.replaySeqs ?? [])).toEqual(
			parsed.secondTabSeqs,
		);
		expect(new Set(parsed.secondTabSeqs ?? []).size).toBe(
			parsed.secondTabSeqs?.length ?? 0,
		);
	});
});
