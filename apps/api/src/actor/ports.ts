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

export type ActorMailboxKind = (typeof ACTOR_MAILBOX_KINDS)[number];
export type ActorStatus = (typeof ACTOR_STATUSES)[number];

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
	inflightWorkflowId: string | null;
	piSessionId: string | null;
	memRef: string | null;
	updatedAt: string;
};

export type ActorEventModel = {
	eventId: number;
	actorId: string;
	seq: number;
	kind: string;
	payload: Record<string, unknown>;
	createdAt: string;
};

export interface ActorRepo {
	createActor(spec: ActorSpecModel): Promise<ActorStateModel>;
	listActors(): Promise<ActorStateModel[]>;
	getActorState(actorId: string): Promise<ActorStateModel | null>;
	postMailboxMessage(input: MailboxPostModel): Promise<ActorEventModel>;
}

export interface ActorWorkflowLauncher {
	enqueueActorTick(actorId: string): Promise<void>;
}
