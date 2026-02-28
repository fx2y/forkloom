import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ActorDurabilityProof = {
	workflowID: string;
	actorId: string;
	crashMarker: string;
	actor: {
		mailbox_cursor: string;
		inflight_workflow_id: string | null;
		status: string;
	} | null;
	messages: Array<{
		seq: string;
		state: string;
		claimed_by: string | null;
		done_at: string | null;
	}>;
	processedEventCount: number;
	lockCount: number;
};

describe("actor tick DBOS live proof", () => {
	it("asserts crash-resume reuses persistBatch and clears the actor lock", () => {
		const proofPath = ".cache/test-int/actor-durability.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/actor-durability.json; run `MISE_EXPERIMENTAL=1 mise run test:int:actor-durability` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<ActorDurabilityProof>;

		expect(parsed.crashMarker).toBe("crashed");
		expect(parsed.workflowID).toBe(`tick:${parsed.actorId}:1`);
		expect(parsed.actor?.mailbox_cursor).toBe("1");
		expect(parsed.actor?.inflight_workflow_id).toBeNull();
		expect(parsed.actor?.status).toBe("idle");
		expect(parsed.messages).toEqual([
			expect.objectContaining({
				seq: "1",
				state: "done",
				claimed_by: parsed.workflowID,
			}),
		]);
		expect(parsed.processedEventCount).toBe(1);
		expect(parsed.lockCount).toBe(0);
	});
});
