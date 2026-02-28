import { describe, expect, it, vi } from "vitest";
import { PiActorBatchProcessor } from "../../apps/api/src/actor";
import type {
	ActorMailboxMessageModel,
	ActorStateModel,
} from "../../apps/api/src/actor";
import type {
	PiSessionPort,
	PiSessionState,
	PiSessionStats,
} from "../../apps/api/src/pi";

function actorState(overrides: Partial<ActorStateModel> = {}): ActorStateModel {
	return {
		actorId: "actor-1",
		name: "ops",
		status: "idle",
		mailboxCursor: 0,
		nextMailboxSeq: 1,
		inflightWorkflowId: null,
		piSessionId: null,
		piSessionFile: null,
		memRef: null,
		workspaceId: null,
		updatedAt: "2026-02-28T00:00:00.000Z",
		...overrides,
	};
}

function mailboxMessage(
	overrides: Partial<ActorMailboxMessageModel> = {},
): ActorMailboxMessageModel {
	return {
		msgId: 1,
		actorId: "actor-1",
		seq: 1,
		kind: "prompt",
		text: "hello",
		attachments: [],
		dedupeKey: null,
		metadata: {},
		state: "claimed",
		claimedBy: "tick:actor-1:1",
		claimedAt: "2026-02-28T00:00:00.000Z",
		claimLeaseMs: 60_000,
		doneAt: null,
		error: null,
		createdAt: "2026-02-28T00:00:00.000Z",
		...overrides,
	};
}

class StubSession implements PiSessionPort {
	public readonly calls: string[] = [];
	public readonly queueModes: Array<Record<string, unknown>> = [];

	async prompt(): Promise<void> {
		this.calls.push("prompt");
	}

	async steer(): Promise<void> {
		this.calls.push("steer");
	}

	async followUp(): Promise<void> {
		this.calls.push("followUp");
	}

	async setQueueMode(input: {
		followUpMode?: "one-at-a-time" | "all" | undefined;
		steeringMode?: "one-at-a-time" | "all" | undefined;
	}): Promise<void> {
		this.queueModes.push(input);
	}

	async abort(): Promise<void> {
		return;
	}

	async getState(): Promise<PiSessionState> {
		return {
			sessionFile: "/tmp/actor.session.jsonl",
			sessionId: "sess-1",
			isStreaming: false,
			pending: 0,
		};
	}

	async getLastAssistantText(): Promise<string> {
		return "done";
	}

	async getSessionStats(): Promise<PiSessionStats> {
		return {};
	}

	drainPendingEvents(): Record<string, unknown>[] {
		return [{ type: "assistant", chunk: "ok" }];
	}

	async waitUntilIdle(options?: {
		onEvent?:
			| ((event: Record<string, unknown>) => Promise<void> | void)
			| undefined;
	}): Promise<void> {
		await options?.onEvent?.({
			type: "tool_execution_end",
			toolCallId: "tc-1",
		});
	}

	async close(): Promise<void> {
		return;
	}
}

describe("PiActorBatchProcessor", () => {
	it("maps prompt mailboxes through prompt and records pi/session events", async () => {
		const session = new StubSession();
		const processor = new PiActorBatchProcessor({
			createPiSession: vi.fn(async () => session),
		});

		const result = await processor.applyBatch({
			actor: actorState(),
			messages: [mailboxMessage()],
			workflowId: "tick:actor-1:1",
		});

		expect(session.calls).toEqual(["prompt"]);
		expect(session.queueModes).toEqual([
			{
				followUpMode: "one-at-a-time",
				steeringMode: "one-at-a-time",
			},
		]);
		expect(result.piSessionId).toBe("sess-1");
		expect(result.events.map((event) => event.kind)).toEqual([
			"session_bound",
			"pi_event",
			"pi_event",
			"pi_event",
			"mailbox_processed",
		]);
	});

	it("maps streaming steer mailboxes through steer instead of prompt", async () => {
		const session = new StubSession();
		session.getState = async () => ({
			sessionFile: "/tmp/actor.session.jsonl",
			sessionId: "sess-1",
			isStreaming: true,
			pending: 1,
		});
		const processor = new PiActorBatchProcessor({
			createPiSession: vi.fn(async () => session),
		});

		await processor.applyBatch({
			actor: actorState({ status: "streaming" }),
			messages: [mailboxMessage({ kind: "steer", text: "stop" })],
			workflowId: "tick:actor-1:1",
		});

		expect(session.calls).toContain("steer");
	});
});
