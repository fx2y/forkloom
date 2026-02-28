import { DBOS } from "@dbos-inc/dbos-sdk";
import { isActorTransientError } from "../actor/errors";
import type {
	ActorBatchProcessor,
	ActorMailboxMessageModel,
	ActorRepo,
	ActorStateModel,
	ActorWorkflowLauncher,
} from "../actor/ports";
import { ACTOR_TICK_BUDGET } from "../actor/runtime";

type ActorTickCoreStepName =
	| "acquireLock"
	| "claimBatch"
	| "loadActor"
	| "ensureSession"
	| "applyBatch"
	| "persistBatch"
	| "markBatch"
	| "releaseLock";

type ActorTickStepRunner = {
	runStep<T>(
		name: ActorTickCoreStepName | "markFailed",
		fn: () => Promise<T>,
	): Promise<T>;
};

export type ActorTickDeps = {
	repo: Pick<
		ActorRepo,
		| "acquireTickLease"
		| "claimNextMessages"
		| "getActorState"
		| "getFirstPendingSeq"
		| "markMessagesDead"
		| "persistProcessedBatch"
		| "requeueMessages"
		| "releaseTickLease"
	>;
	processor: ActorBatchProcessor;
	workflowLauncher: ActorWorkflowLauncher;
	maxMessagesPerTick?: number | undefined;
	leaseMs?: number | undefined;
	workflowId?: string | undefined;
	onAfterStep?:
		| ((name: ActorTickCoreStepName, actorId: string) => Promise<void> | void)
		| undefined;
};

export type RegisteredActorWorkflow = (actorId: string) => Promise<void>;

const dbosStepRunner: ActorTickStepRunner = {
	runStep<T>(
		name: ActorTickCoreStepName | "markFailed",
		fn: () => Promise<T>,
	): Promise<T> {
		return DBOS.runStep(fn, { name });
	},
};

function normalizeErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return String(error);
}

function requireWorkflowId(): string {
	if (!DBOS.workflowID) {
		throw new Error("ActorTick requires DBOS workflowID");
	}
	return DBOS.workflowID;
}

function assertActor(
	actorId: string,
	actor: ActorStateModel | null,
): ActorStateModel {
	if (!actor) {
		throw new Error(`actor not found: ${actorId}`);
	}
	return actor;
}

function shouldEnqueueNextTick(actor: ActorStateModel | null): boolean {
	return actor?.status !== "blocked" && actor?.status !== "dead";
}

async function maybeAfterStep(
	deps: ActorTickDeps,
	name: ActorTickCoreStepName,
	actorId: string,
): Promise<void> {
	await deps.onAfterStep?.(name, actorId);
}

export async function executeActorTick(
	actorId: string,
	deps: ActorTickDeps,
	steps: ActorTickStepRunner = dbosStepRunner,
): Promise<void> {
	const workflowId = deps.workflowId ?? requireWorkflowId();
	const leaseMs = deps.leaseMs ?? ACTOR_TICK_BUDGET.leaseMs;
	const maxMessagesPerTick =
		deps.maxMessagesPerTick ?? ACTOR_TICK_BUDGET.maxMessagesPerTick;
	let lockAcquired = false;
	let activeBatch: ActorMailboxMessageModel[] = [];
	let remainingPendingSeq: number | null = null;
	let processedMessages = 0;

	try {
		lockAcquired = await steps.runStep("acquireLock", () =>
			deps.repo.acquireTickLease({ actorId, workflowId, leaseMs }),
		);
		await maybeAfterStep(deps, "acquireLock", actorId);
		if (!lockAcquired) {
			return;
		}

		while (processedMessages < maxMessagesPerTick) {
			const claimed = await steps.runStep("claimBatch", () =>
				deps.repo.claimNextMessages({
					actorId,
					workflowId,
					maxMessages: 1,
				}),
			);
			await maybeAfterStep(deps, "claimBatch", actorId);
			activeBatch = claimed;
			if (claimed.length === 0) {
				remainingPendingSeq = await deps.repo.getFirstPendingSeq(actorId);
				break;
			}

			const actor = assertActor(
				actorId,
				await steps.runStep("loadActor", () =>
					deps.repo.getActorState(actorId),
				),
			);
			await maybeAfterStep(deps, "loadActor", actorId);

			await steps.runStep("ensureSession", () =>
				deps.processor.ensureSession(actor),
			);
			await maybeAfterStep(deps, "ensureSession", actorId);

			const batchResult = await steps.runStep("applyBatch", () =>
				deps.processor.applyBatch({ actor, messages: claimed, workflowId }),
			);
			await maybeAfterStep(deps, "applyBatch", actorId);

			const persisted = await steps.runStep("persistBatch", () =>
				deps.repo.persistProcessedBatch({
					actorId,
					workflowId,
					seqs: claimed.map((message) => message.seq),
					actorStatus: batchResult.actorStatus,
					piSessionId: batchResult.piSessionId,
					piSessionFile: batchResult.piSessionFile,
					events: batchResult.events,
				}),
			);
			await maybeAfterStep(deps, "persistBatch", actorId);

			const marked = await steps.runStep("markBatch", async () => ({
				mailboxCursor: persisted.mailboxCursor,
				remainingPendingSeq: persisted.remainingPendingSeq,
			}));
			await maybeAfterStep(deps, "markBatch", actorId);
			activeBatch = [];
			remainingPendingSeq = marked.remainingPendingSeq;
			processedMessages += claimed.length;

			if (remainingPendingSeq == null) {
				break;
			}
		}
	} catch (error) {
		if (lockAcquired && activeBatch.length > 0) {
			const failedSeqs = activeBatch.map((message) => message.seq);
			const next = isActorTransientError(error)
				? await steps.runStep("markFailed", () =>
						deps.repo.requeueMessages({
							actorId,
							workflowId,
							seqs: failedSeqs,
						}),
					)
				: await steps.runStep("markFailed", () =>
						deps.repo.markMessagesDead({
							actorId,
							workflowId,
							seqs: failedSeqs,
							error: normalizeErrorMessage(error),
						}),
					);
			remainingPendingSeq = next.remainingPendingSeq;
			activeBatch = [];
		}
		throw error;
	} finally {
		if (lockAcquired) {
			await steps.runStep("releaseLock", async () => {
				const nextPendingSeq =
					remainingPendingSeq ?? (await deps.repo.getFirstPendingSeq(actorId));
				const actor = await deps.repo.getActorState(actorId);
				await deps.repo.releaseTickLease(actorId, workflowId);
				if (nextPendingSeq != null && shouldEnqueueNextTick(actor)) {
					await deps.workflowLauncher.enqueueActorTick({
						actorId,
						firstPendingSeq: nextPendingSeq,
					});
				}
			});
		}
	}
}

let activeDeps: ActorTickDeps | null = null;
let registeredWorkflow: RegisteredActorWorkflow | null = null;

export function registerActorTickWorkflow(
	deps: ActorTickDeps,
): RegisteredActorWorkflow {
	activeDeps = deps;
	if (!registeredWorkflow) {
		registeredWorkflow = DBOS.registerWorkflow(
			async (actorId: string): Promise<void> => {
				const currentDeps = activeDeps;
				if (!currentDeps) {
					throw new Error("ActorTick deps are not registered");
				}
				await executeActorTick(actorId, currentDeps, dbosStepRunner);
			},
			{
				name: "forkloomActorTick",
			},
		);
	}
	return registeredWorkflow;
}
