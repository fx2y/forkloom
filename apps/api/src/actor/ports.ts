import type { ArtifactPointer } from "../run/ports";

export const ACTOR_MAILBOX_KINDS = [
	"prompt",
	"steer",
	"followUp",
	"system",
	"timer",
	"agent2agent",
] as const;

export const ACTOR_STATUSES = ["idle", "streaming", "blocked", "dead"] as const;
export const ACTOR_MAILBOX_STATES = [
	"queued",
	"claimed",
	"done",
	"dead",
] as const;

export type ActorMailboxKind = (typeof ACTOR_MAILBOX_KINDS)[number];
export type ActorStatus = (typeof ACTOR_STATUSES)[number];
export type ActorMailboxState = (typeof ACTOR_MAILBOX_STATES)[number];

export type ActorSpecModel = {
	actorId: string;
	name: string;
	status: ActorStatus;
	workspaceId?: string | undefined;
	memRef?: string | undefined;
	piSessionId?: string | undefined;
};

export type MailboxPostModel = {
	actorId: string;
	kind: ActorMailboxKind;
	text: string;
	attachments: ArtifactPointer[];
	dedupeKey?: string | undefined;
	metadata?: Record<string, unknown> | undefined;
};

export type ActorStateModel = {
	actorId: string;
	name: string;
	status: ActorStatus;
	mailboxCursor: number;
	nextMailboxSeq: number;
	inflightWorkflowId: string | null;
	piSessionId: string | null;
	piSessionFile: string | null;
	memRef: string | null;
	workspaceId: string | null;
	updatedAt: string;
};

export type ActorMailboxMessageModel = {
	msgId: number;
	actorId: string;
	seq: number;
	kind: ActorMailboxKind;
	text: string;
	attachments: ArtifactPointer[];
	dedupeKey: string | null;
	metadata: Record<string, unknown>;
	state: ActorMailboxState;
	claimedBy: string | null;
	claimedAt: string | null;
	claimLeaseMs: number;
	doneAt: string | null;
	error: string | null;
	createdAt: string;
};

export type ActorEventModel = {
	eventId: number;
	actorId: string;
	seq: number;
	kind: string;
	payload: Record<string, unknown>;
	createdAt: string;
};

export type ActorMailboxPostResult = {
	message: ActorMailboxMessageModel;
	event: ActorEventModel;
	firstPendingSeq: number;
};

export type ActorTickRequest = {
	actorId: string;
	firstPendingSeq: number;
};

export type ActorBatchEffect = {
	kind: string;
	payload: Record<string, unknown>;
};

export type ActorBatchResult = {
	actorStatus?: ActorStatus | undefined;
	piSessionId?: string | undefined;
	piSessionFile?: string | undefined;
	events: ActorBatchEffect[];
};

export interface ActorRepo {
	createActor(spec: ActorSpecModel): Promise<ActorStateModel>;
	listActors(): Promise<ActorStateModel[]>;
	getActorState(actorId: string): Promise<ActorStateModel | null>;
	listActorEvents(
		actorId: string,
		sinceEventId: number,
		limit: number,
	): Promise<ActorEventModel[]>;
	postMailboxMessage(input: MailboxPostModel): Promise<ActorMailboxPostResult>;
	acquireTickLease(input: {
		actorId: string;
		workflowId: string;
		leaseMs: number;
	}): Promise<boolean>;
	claimNextMessages(input: {
		actorId: string;
		workflowId: string;
		maxMessages: number;
	}): Promise<ActorMailboxMessageModel[]>;
	persistProcessedBatch(input: {
		actorId: string;
		workflowId: string;
		seqs: number[];
		actorStatus?: ActorStatus | undefined;
		piSessionId?: string | undefined;
		piSessionFile?: string | undefined;
		events: ActorBatchEffect[];
	}): Promise<{
		actor: ActorStateModel;
		events: ActorEventModel[];
		mailboxCursor: number;
		remainingPendingSeq: number | null;
	}>;
	markMessagesDead(input: {
		actorId: string;
		workflowId: string;
		seqs: number[];
		error: string;
		actorStatus?: ActorStatus | undefined;
	}): Promise<{ remainingPendingSeq: number | null }>;
	requeueMessages(input: {
		actorId: string;
		workflowId: string;
		seqs: number[];
	}): Promise<{ remainingPendingSeq: number | null }>;
	getFirstPendingSeq(actorId: string): Promise<number | null>;
	releaseTickLease(actorId: string, workflowId: string): Promise<void>;
}

export interface ActorWorkflowLauncher {
	enqueueActorTick(input: ActorTickRequest): Promise<void>;
}

export interface ActorBatchProcessor {
	ensureSession(actor: ActorStateModel): Promise<void>;
	applyBatch(input: {
		actor: ActorStateModel;
		messages: ActorMailboxMessageModel[];
		workflowId: string;
	}): Promise<ActorBatchResult>;
}
