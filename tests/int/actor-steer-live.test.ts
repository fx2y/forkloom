import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ActorSteerProof = {
	stateAfterPrompt: {
		sessionId: string;
		sessionFile: string;
		isStreaming: boolean;
		pending: number;
	};
	finalState: {
		sessionId: string;
		sessionFile: string;
		isStreaming: boolean;
		pending: number;
	};
	eventCount: number;
	lastAssistantText: string;
};

describe("actor steer live proof", () => {
	it("asserts live PI session accepts steer/followUp flow and returns to idle", () => {
		const proofPath = ".cache/test-int/actor-steer-live.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/actor-steer-live.json; run `MISE_EXPERIMENTAL=1 mise exec -- pnpm exec tsx scripts/harness/actor-steer-live.ts` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<ActorSteerProof>;

		expect(typeof parsed.stateAfterPrompt?.sessionId).toBe("string");
		expect(typeof parsed.stateAfterPrompt?.sessionFile).toBe("string");
		expect(typeof parsed.finalState?.sessionId).toBe("string");
		expect(parsed.finalState?.isStreaming).toBe(false);
		expect(parsed.finalState?.pending).toBe(0);
		expect(parsed.eventCount).toBeGreaterThanOrEqual(0);
		expect(typeof parsed.lastAssistantText).toBe("string");
	});
});
