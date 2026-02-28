import { describe, expect, it, vi } from "vitest";
import { ActorService, normalizeMailboxText } from "../../apps/api/src/actor";
import type {
	ActorEventModel,
	ActorMailboxPostResult,
	ActorRepo,
	ActorStateModel,
	ActorWorkflowLauncher,
	MailboxPostModel,
} from "../../apps/api/src/actor";

function actorState(overrides: Partial<ActorStateModel> = {}): ActorStateModel {
	return {
		actorId: "actor-1",
		name: "worker",
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

function mailboxPostResult(
	overrides: Partial<ActorMailboxPostResult> = {},
): ActorMailboxPostResult {
	const event: ActorEventModel = {
		eventId: 7,
		actorId: "actor-1",
		seq: 7,
		kind: "mailbox_queued",
		payload: { seq: 3 },
		createdAt: "2026-02-28T00:00:00.000Z",
	};
	return {
		message: {
			msgId: 3,
			actorId: "actor-1",
			seq: 3,
			kind: "prompt",
			text: "hello",
			attachments: [],
			dedupeKey: "msg-1",
			metadata: {},
			state: "queued",
			claimedBy: null,
			claimedAt: null,
			claimLeaseMs: 60_000,
			doneAt: null,
			error: null,
			createdAt: "2026-02-28T00:00:00.000Z",
		},
		event,
		firstPendingSeq: 3,
		...overrides,
	};
}

function createRepo(
	postResult: ActorMailboxPostResult = mailboxPostResult(),
): ActorRepo {
	return {
		createActor: async () => actorState(),
		listActors: async () => [actorState()],
		getActorState: async () => actorState(),
		listActorEvents: async () => [],
		postMailboxMessage: async () => postResult,
		acquireTickLease: async () => true,
		claimNextMessages: async () => [],
		persistProcessedBatch: async () => ({
			actor: actorState(),
			events: [],
			mailboxCursor: 0,
			remainingPendingSeq: null,
		}),
		markMessagesDead: async () => ({ remainingPendingSeq: null }),
		requeueMessages: async () => ({ remainingPendingSeq: null }),
		getFirstPendingSeq: async () => null,
		releaseTickLease: async () => undefined,
	};
}

describe("normalizeMailboxText", () => {
	it("trims message text and rejects slash commands", () => {
		expect(normalizeMailboxText("  hello  ")).toBe("hello");
		expect(() => normalizeMailboxText("   ")).toThrow(
			"message text is required",
		);
		expect(() => normalizeMailboxText(" /help")).toThrow(
			"mailbox commands are forbidden",
		);
	});
});

describe("ActorService", () => {
	it("posts a mailbox message and enqueues the earliest pending tick", async () => {
		const launcher: ActorWorkflowLauncher = {
			enqueueActorTick: vi.fn(async () => undefined),
		};
		const repo = createRepo(mailboxPostResult({ firstPendingSeq: 2 }));
		const service = new ActorService({ repo, workflowLauncher: launcher });

		const event = await service.sendMessage({
			actorId: "actor-1",
			kind: "prompt",
			text: "  hello  ",
			attachments: [],
			dedupeKey: "msg-1",
		});

		expect(event.kind).toBe("mailbox_queued");
		expect(launcher.enqueueActorTick).toHaveBeenCalledWith({
			actorId: "actor-1",
			firstPendingSeq: 2,
		});
	});

	it("passes trimmed text into repo writes", async () => {
		const calls: MailboxPostModel[] = [];
		const repo = createRepo();
		repo.postMailboxMessage = async (input) => {
			calls.push(input);
			return mailboxPostResult();
		};
		const service = new ActorService({
			repo,
			workflowLauncher: { enqueueActorTick: async () => undefined },
		});

		await service.sendMessage({
			actorId: "actor-1",
			kind: "followUp",
			text: "  keep going  ",
			attachments: [],
		});

		expect(calls[0]?.text).toBe("keep going");
	});
});
