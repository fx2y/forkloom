import type {
	ActorBatchProcessor,
	ActorBatchResult,
	ActorMailboxMessageModel,
	ActorStateModel,
} from "./ports";

function toMailboxProcessedEvent(message: ActorMailboxMessageModel) {
	return {
		kind: "mailbox_processed",
		payload: {
			msgId: message.msgId,
			seq: message.seq,
			kind: message.kind,
		},
	};
}

export class NoopActorBatchProcessor implements ActorBatchProcessor {
	async ensureSession(_actor: ActorStateModel): Promise<void> {
		return;
	}

	async applyBatch(input: {
		actor: ActorStateModel;
		messages: ActorMailboxMessageModel[];
		workflowId: string;
	}): Promise<ActorBatchResult> {
		return {
			actorStatus: input.actor.status,
			events: input.messages.map(toMailboxProcessedEvent),
		};
	}
}
