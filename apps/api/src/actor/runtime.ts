import { DBOS, WorkflowQueue } from "@dbos-inc/dbos-sdk";
import type { RegisteredActorWorkflow } from "../workflow/actor-tick";
import type { ActorTickRequest, ActorWorkflowLauncher } from "./ports";

export const ACTOR_TICK_QUEUE = new WorkflowQueue("actor_tick_q", {
	workerConcurrency: 8,
});

export const ACTOR_TICK_BUDGET = {
	leaseMs: 60_000,
	maxMessagesPerTick: 25,
} as const;

export function toActorTickWorkflowId(
	actorId: string,
	firstPendingSeq: number,
): string {
	return `tick:${actorId}:${firstPendingSeq}`;
}

export class DbosActorWorkflowLauncher implements ActorWorkflowLauncher {
	constructor(private readonly workflow: RegisteredActorWorkflow) {}

	async enqueueActorTick(input: ActorTickRequest): Promise<void> {
		await DBOS.startWorkflow(this.workflow, {
			queueName: ACTOR_TICK_QUEUE.name,
			workflowID: toActorTickWorkflowId(input.actorId, input.firstPendingSeq),
		})(input.actorId);
	}
}

export class LazyDbosActorWorkflowLauncher implements ActorWorkflowLauncher {
	private inner: ActorWorkflowLauncher | null = null;

	bind(workflow: RegisteredActorWorkflow): void {
		this.inner = new DbosActorWorkflowLauncher(workflow);
	}

	async enqueueActorTick(input: ActorTickRequest): Promise<void> {
		if (!this.inner) {
			throw new Error("ActorTick workflow is not registered");
		}
		await this.inner.enqueueActorTick(input);
	}
}
