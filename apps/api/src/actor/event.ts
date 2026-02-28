import type {
	ActorEvent as ActorEventContract,
	ActorState as ActorStateContract,
	MailboxKind,
} from "@forkloom/contracts";
import type {
	ActorBatchEffect,
	ActorEventModel,
	ActorMailboxMessageModel,
	ActorStateModel,
} from "./ports";

export const ACTOR_EVENT_KINDS = [
	"mailbox_queued",
	"session_bound",
	"pi_event",
	"mailbox_processed",
	"mailbox_failed",
] as const;

export type ActorEventKind = (typeof ACTOR_EVENT_KINDS)[number];

export function appendActorEvent(
	kind: ActorEventKind,
	payload: Record<string, unknown>,
): ActorBatchEffect {
	return { kind, payload };
}

export function toPiEventEffect(input: {
	message: ActorMailboxMessageModel;
	event: Record<string, unknown>;
}): ActorBatchEffect {
	return appendActorEvent("pi_event", {
		msgId: input.message.msgId,
		seq: input.message.seq,
		mailboxKind: input.message.kind,
		event: input.event,
	});
}

export function toSessionBoundEffect(input: {
	message: ActorMailboxMessageModel;
	sessionId: string;
	sessionFile: string;
}): ActorBatchEffect {
	return appendActorEvent("session_bound", {
		msgId: input.message.msgId,
		seq: input.message.seq,
		sessionId: input.sessionId,
		sessionFile: input.sessionFile,
	});
}

export function toMailboxProcessedEffect(input: {
	message: ActorMailboxMessageModel;
	sessionId: string;
	sessionFile: string;
	lastAssistantText: string;
}): ActorBatchEffect {
	return appendActorEvent("mailbox_processed", {
		msgId: input.message.msgId,
		seq: input.message.seq,
		kind: input.message.kind,
		sessionId: input.sessionId,
		sessionFile: input.sessionFile,
		lastAssistantText: input.lastAssistantText,
		attachments: input.message.attachments,
	});
}

export function toMailboxFailedEffect(input: {
	seq: number;
	kind: MailboxKind;
	error: string;
}): ActorBatchEffect {
	return appendActorEvent("mailbox_failed", {
		seq: input.seq,
		kind: input.kind,
		error: input.error,
	});
}

export function toActorEventContract(
	event: ActorEventModel,
): ActorEventContract {
	return {
		actorId: event.actorId,
		seq: event.seq,
		t: event.createdAt,
		kind: event.kind as ActorEventContract["kind"],
		payload: event.payload,
	};
}

export function toActorStateContract(
	state: ActorStateModel,
): ActorStateContract {
	return {
		actorId: state.actorId,
		name: state.name,
		status: state.status,
		mailboxCursor: state.mailboxCursor,
		updatedAt: state.updatedAt,
	};
}
