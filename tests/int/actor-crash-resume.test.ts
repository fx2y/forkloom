import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ActorDurabilityProof = {
	workflowID: string;
	actorId: string;
	crashMarker: string;
	strictReal: boolean;
	fallbackUsed: boolean;
	actor: {
		mailbox_cursor: string;
		inflight_workflow_id: string | null;
		status: string;
		pi_session_file: string | null;
	} | null;
	messages: Array<{
		seq: string;
		state: string;
		claimed_by: string | null;
		done_at: string | null;
	}>;
	persistedEventCounts: Record<string, number>;
	persistedEventKinds: string[];
	persistedActorEventCount: number;
	persistedPiEventCount: number;
	lockCount: number;
};

describe("actor tick DBOS live proof", () => {
	it("asserts crash-resume clears the lock and persists recovered mailbox lifecycle rows", () => {
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
		expect(typeof parsed.strictReal).toBe("boolean");
		expect(typeof parsed.fallbackUsed).toBe("boolean");
		if (parsed.strictReal) {
			expect(parsed.fallbackUsed).toBe(false);
		}
		expect(parsed.workflowID).toBe(`tick:${parsed.actorId}:1`);
		expect(parsed.actor?.mailbox_cursor).toBe("1");
		expect(parsed.actor?.inflight_workflow_id).toBeNull();
		expect(parsed.actor?.status).toBe("idle");
		expect(typeof parsed.actor?.pi_session_file).toBe("string");
		expect(parsed.messages).toEqual([
			expect.objectContaining({
				seq: "1",
				state: "done",
				claimed_by: parsed.workflowID,
			}),
		]);
		expect(parsed.persistedEventKinds).toContain("session_bound");
		expect(parsed.persistedEventKinds).toContain("mailbox_processed");
		expect(parsed.persistedEventCounts?.mailbox_queued).toBe(1);
		expect(parsed.persistedActorEventCount).toBeGreaterThanOrEqual(3);
		expect(parsed.persistedPiEventCount).toBeGreaterThanOrEqual(0);
		expect(parsed.lockCount).toBe(0);
	});
});
