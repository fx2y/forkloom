import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type SkillLiveProof = {
	status: string;
	runId: string;
	runStatus: string;
	skillExecStepCount: number;
	skillExecLinkCount: number;
	skillOutputArtifacts: Array<{ kind: string; sha256: string }>;
	actionCount: number;
	launcher: string;
};

describe("run skill live proof", () => {
	it("records durable /skill execution evidence through run truth + DB", () => {
		const proofPath = ".cache/spec08/skills-live-proof.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/spec08/skills-live-proof.json; run `MISE_EXPERIMENTAL=1 mise run test:int:run-skill-live` first",
			);
		}
		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as SkillLiveProof;
		expect(parsed.status).toBe("ok");
		expect(parsed.runId.length).toBeGreaterThan(0);
		expect(["running", "done", "failed", "aborted"]).toContain(
			parsed.runStatus,
		);
		expect(parsed.skillExecStepCount).toBeGreaterThanOrEqual(1);
		expect(parsed.skillExecLinkCount).toBeGreaterThanOrEqual(1);
		expect(parsed.skillOutputArtifacts.length).toBeGreaterThanOrEqual(2);
		expect(
			parsed.skillOutputArtifacts.every(
				(row) => row.kind === "skill_output_file",
			),
		).toBe(true);
		expect(parsed.actionCount).toBeGreaterThanOrEqual(2);
		expect(parsed.launcher).toBe("enqueueActorTick");
	});
});
