import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type SandboxFunctionalProof = {
	runId: string;
	sandboxId: string;
	postWakeText: string;
	postRecreateText: string;
	sessionFile: string;
	sessionFileExists: boolean;
	sessionLogKinds: string[];
	assistantText: string;
	stats: Record<string, unknown>;
};

describe("sandbox functional live proof", () => {
	it("proves docker lifecycle persistence and in-sandbox pi control transport", () => {
		const proofPath = ".cache/test-int/run-sandbox-functional.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/run-sandbox-functional.json; run `MISE_EXPERIMENTAL=1 mise run test:int:run-sandbox-functional` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<SandboxFunctionalProof>;

		expect(typeof parsed.runId).toBe("string");
		expect(typeof parsed.sandboxId).toBe("string");
		expect(parsed.postWakeText).toBe("sandbox-persist");
		expect(parsed.postRecreateText).toBe("sandbox-persist");
		expect(typeof parsed.sessionFile).toBe("string");
		expect(parsed.sessionFileExists).toBe(true);
		expect(parsed.sessionLogKinds).toEqual([
			"session",
			"prompt",
			"steer",
			"follow_up",
			"abort",
		]);
		expect(parsed.assistantText).toBe("sandbox ok");
		expect(parsed.stats).toMatchObject({ totalTokens: 4, toolCalls: 1 });
	});
});
