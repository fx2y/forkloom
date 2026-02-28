import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ActorSteerProof = {
	stateAfterPrompt: {
		status: string;
	};
	finalState: {
		status: string;
	};
	rowAfterPrompt: {
		status: string;
		pi_session_id: string;
		pi_session_file: string;
	} | null;
	rowAfterSteer: {
		status: string;
		pi_session_id: string;
		pi_session_file: string;
	} | null;
	followUpPosted: {
		payload: {
			kind: string;
		};
	};
	steerPosted: {
		payload: {
			kind: string;
		};
	};
	followUpEventCount: number;
	steerEventCount: number;
};

describe("actor steer live proof", () => {
	it("asserts /actors steer and followUp resume the same session after api restart", () => {
		const proofPath = ".cache/test-int/actor-steer-live.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/actor-steer-live.json; run `MISE_EXPERIMENTAL=1 mise exec -- pnpm exec tsx scripts/harness/actor-steer-live.ts` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<ActorSteerProof>;

		expect(parsed.stateAfterPrompt?.status).toBe("idle");
		expect(parsed.finalState?.status).toBe("idle");
		expect(parsed.rowAfterPrompt?.status).toBe("idle");
		expect(parsed.rowAfterSteer?.status).toBe("idle");
		expect(parsed.rowAfterPrompt?.pi_session_id).toBe(
			parsed.rowAfterSteer?.pi_session_id,
		);
		expect(parsed.rowAfterPrompt?.pi_session_file).toBe(
			parsed.rowAfterSteer?.pi_session_file,
		);
		expect(parsed.followUpPosted?.payload.kind).toBe("followUp");
		expect(parsed.steerPosted?.payload.kind).toBe("steer");
		expect(parsed.followUpEventCount).toBeGreaterThan(0);
		expect(parsed.steerEventCount).toBeGreaterThan(0);
	});
});
