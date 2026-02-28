import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type ActorFunctionalProof = {
	actorId: string;
	attachmentSha256: string;
	strictReal: boolean;
	provider: string | null;
	model: string | null;
	fallbackUsed: boolean;
	piEventCount: number;
	eventKinds: string[];
	eventSeqs: number[];
	actorState: {
		status: string;
		mailboxCursor: number;
	};
	actorRow: {
		status: string;
		mailbox_cursor: string;
		pi_session_id: string | null;
		pi_session_file: string | null;
	} | null;
	queuedEvent: {
		payload: {
			attachments?: Array<{ sha256: string }>;
		};
	} | null;
	processedEvent: {
		payload: {
			lastAssistantText?: string;
			attachments?: Array<{ sha256: string }>;
		};
	} | null;
};

describe("actor functional live proof", () => {
	it("asserts live actor routes persist session refs and append replayable events", () => {
		const proofPath = ".cache/test-int/actor-functional.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/actor-functional.json; run `MISE_EXPERIMENTAL=1 mise run test:int:actor-functional` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<ActorFunctionalProof>;

		expect(typeof parsed.actorId).toBe("string");
		expect(typeof parsed.strictReal).toBe("boolean");
		expect(typeof parsed.provider).toBe("string");
		expect(typeof parsed.model).toBe("string");
		expect(typeof parsed.fallbackUsed).toBe("boolean");
		expect(parsed.piEventCount).toBeGreaterThanOrEqual(0);
		if (parsed.strictReal) {
			expect(parsed.fallbackUsed).toBe(false);
			expect(parsed.provider).not.toContain("forkloom-mock");
			expect(parsed.model).not.toContain("forkloom-mock");
		} else {
			expect(parsed.piEventCount).toBeGreaterThan(0);
		}
		expect(parsed.eventKinds).toContain("mailbox_queued");
		expect(parsed.eventKinds).toContain("mailbox_processed");
		if (!parsed.strictReal) {
			expect(parsed.eventKinds).toContain("pi_event");
		}
		expect(parsed.actorState?.status).toBe("idle");
		expect(parsed.actorState?.mailboxCursor).toBeGreaterThanOrEqual(1);
		expect(parsed.actorRow?.status).toBe("idle");
		expect(parsed.actorRow?.mailbox_cursor).toBe("1");
		expect(typeof parsed.actorRow?.pi_session_id).toBe("string");
		expect(typeof parsed.actorRow?.pi_session_file).toBe("string");
		expect(parsed.queuedEvent?.payload.attachments).toEqual([
			{ sha256: parsed.attachmentSha256 ?? "" },
		]);
		expect(parsed.processedEvent?.payload.attachments).toEqual([
			{ sha256: parsed.attachmentSha256 ?? "" },
		]);
		expect(
			parsed.processedEvent?.payload.lastAssistantText?.length,
		).toBeGreaterThanOrEqual(0);
		expect(new Set(parsed.eventSeqs ?? []).size).toBe(parsed.eventSeqs?.length);
	});
});
