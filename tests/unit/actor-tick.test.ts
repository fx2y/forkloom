import { describe, expect, it } from "vitest";
import {
	ActorTransientError,
	NoopActorBatchProcessor,
} from "../../apps/api/src/actor";
import type {
	ActorMailboxMessageModel,
	ActorRepo,
	ActorStateModel,
	ActorWorkflowLauncher,
} from "../../apps/api/src/actor";
import { executeActorTick } from "../../apps/api/src/workflow/actor-tick";

type StepName =
	| "acquireLock"
	| "claimBatch"
	| "loadActor"
	| "ensureSession"
	| "applyBatch"
	| "persistBatch"
	| "markBatch"
	| "releaseLock"
	| "markFailed";

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

function createRepo(overrides: Partial<ActorRepo> = {}): ActorRepo {
	return {
		createActor: async () => actorState(),
		listActors: async () => [actorState()],
		getActorState: async () => actorState(),
		listActorEvents: async () => [],
		postMailboxMessage: async () => {
			throw new Error("unused");
		},
		acquireTickLease: async () => true,
		claimNextMessages: async () => [],
		persistProcessedBatch: async () => ({
			actor: actorState(),
			events: [],
			mailboxCursor: 1,
			remainingPendingSeq: null,
		}),
		markMessagesDead: async () => ({ remainingPendingSeq: null }),
		requeueMessages: async () => ({ remainingPendingSeq: null }),
		getFirstPendingSeq: async () => null,
		releaseTickLease: async () => undefined,
		...overrides,
	};
}

function stepRunner(stepNames: StepName[]) {
	return {
		async runStep<T>(name: StepName, fn: () => Promise<T>): Promise<T> {
			stepNames.push(name);
			return fn();
		},
	};
}

describe("executeActorTick", () => {
	it("returns early when another workflow holds the actor lease", async () => {
		const steps: StepName[] = [];
		await executeActorTick(
			"actor-1",
			{
				repo: createRepo({
					acquireTickLease: async () => false,
				}),
				processor: new NoopActorBatchProcessor(),
				workflowLauncher: { enqueueActorTick: async () => undefined },
				workflowId: "tick:actor-1:1",
			},
			stepRunner(steps),
		);

		expect(steps).toEqual(["acquireLock"]);
	});

	it("marks failed batches and still releases the lease on processor errors", async () => {
		const steps: StepName[] = [];
		const calls = {
			released: 0,
			failed: 0,
		};
		await expect(
			executeActorTick(
				"actor-1",
				{
					repo: createRepo({
						claimNextMessages: async () => [mailboxMessage()],
						markMessagesDead: async () => {
							calls.failed += 1;
							return { remainingPendingSeq: null };
						},
						releaseTickLease: async () => {
							calls.released += 1;
						},
					}),
					processor: {
						ensureSession: async () => undefined,
						applyBatch: async () => {
							throw new Error("boom");
						},
					},
					workflowLauncher: { enqueueActorTick: async () => undefined },
					workflowId: "tick:actor-1:1",
				},
				stepRunner(steps),
			),
		).rejects.toThrow("boom");

		expect(calls.failed).toBe(1);
		expect(calls.released).toBe(1);
		expect(steps).toContain("markFailed");
		expect(steps.at(-1)).toBe("releaseLock");
	});

	it("re-enqueues the next pending seq after marking a batch done", async () => {
		const queued: Array<{ actorId: string; firstPendingSeq: number }> = [];
		await executeActorTick(
			"actor-1",
			{
				repo: createRepo({
					claimNextMessages: async () => [mailboxMessage()],
					persistProcessedBatch: async () => ({
						actor: actorState({ mailboxCursor: 1 }),
						events: [],
						mailboxCursor: 1,
						remainingPendingSeq: 2,
					}),
				}),
				processor: new NoopActorBatchProcessor(),
				workflowLauncher: {
					enqueueActorTick: async (input) => {
						queued.push(input);
					},
				} satisfies ActorWorkflowLauncher,
				maxMessagesPerTick: 1,
				workflowId: "tick:actor-1:1",
			},
			stepRunner([]),
		);

		expect(queued).toEqual([{ actorId: "actor-1", firstPendingSeq: 2 }]);
	});

	it("requeues transient batches instead of dead-lettering them", async () => {
		let requeued = 0;
		let dead = 0;
		const queued: Array<{ actorId: string; firstPendingSeq: number }> = [];
		await expect(
			executeActorTick(
				"actor-1",
				{
					repo: createRepo({
						claimNextMessages: async () => [mailboxMessage()],
						requeueMessages: async () => {
							requeued += 1;
							return { remainingPendingSeq: 1 };
						},
						markMessagesDead: async () => {
							dead += 1;
							return { remainingPendingSeq: null };
						},
					}),
					processor: {
						ensureSession: async () => undefined,
						applyBatch: async () => {
							throw new ActorTransientError("timeout waiting pi response");
						},
					},
					workflowLauncher: {
						enqueueActorTick: async (input) => {
							queued.push(input);
						},
					},
					workflowId: "tick:actor-1:1",
				},
				stepRunner([]),
			),
		).rejects.toThrow("timeout waiting pi response");

		expect(requeued).toBe(1);
		expect(dead).toBe(0);
		expect(queued).toEqual([{ actorId: "actor-1", firstPendingSeq: 1 }]);
	});
});
