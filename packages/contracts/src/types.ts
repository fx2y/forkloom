/*
 * GENERATED FILE - DO NOT EDIT.
 * Run: pnpm exec tsx packages/contracts/src/typegen.ts --write
 */

export type Delivery = "steer" | "follow";
export type Scope = "me" | "team" | "org";
export type Role = "user" | "agent" | "system";
export type ArtifactType = "raw" | "md" | "json" | "trace" | "other";
export type WorkflowStatus = "queued" | "running" | "done" | "err";
export type ExtensionCapability = "tool" | "cmd" | "ui" | "gate";
export type RunScope = "me" | "team" | "org";
export type RunStatus = "queued" | "running" | "done" | "failed";
export type RunEventKind =
	| "run_started"
	| "pi_event"
	| "artifact_written"
	| "run_done"
	| "run_failed";
export type MailboxKind =
	| "prompt"
	| "steer"
	| "followUp"
	| "system"
	| "timer"
	| "agent2agent";
export type ActorStatus = "idle" | "streaming" | "blocked" | "dead";
export type ActorEventKind =
	| "mailbox_queued"
	| "session_bound"
	| "pi_event"
	| "mailbox_processed"
	| "mailbox_failed";

export type ArtifactRef = {
	sha256: string;
};

export type RunArtifactRef = {
	sha256: string;
};

export type ActorArtifactRef = {
	sha256: string;
};

export type Message = {
	id: string;
	ts: string;
	role: Role;
	text: string;
	scope: Scope;
	threadId: string;
	delivery: Delivery;
	attachments: ArtifactRef[];
	meta: Record<string, unknown>;
};

export type Artifact = {
	sha256: string;
	uri: string;
	mime: string;
	bytes: number;
	createdAt: string;
	type: ArtifactType;
	parents: string[];
	meta: Record<string, unknown>;
};

export type Workflow = {
	name: string;
	runId: string;
	status: WorkflowStatus;
	idempotencyKey: string;
	input?: ArtifactRef | Record<string, unknown>;
};

export type Skill = {
	skillId: string;
	path: string;
	name: string;
	description: string;
	allowedTools?: string[];
	version?: string;
};

export type Extension = {
	name: string;
	version: string;
	entry: string;
	capabilities: ExtensionCapability[];
};

export type RunSpec = {
	runId: string;
	scope: RunScope;
	userMsg: string;
	attachments: RunArtifactRef[];
	workdirRef?: RunArtifactRef;
	modelPref?: string;
};

export type RunState = {
	runId: string;
	status: RunStatus;
	startedAt: string;
	finishedAt?: string;
	dbosWfId: string;
	piSessionId?: string;
	piSessionFile?: string;
	artifacts: RunArtifactRef[];
};

export type RunStartedPayload = {
	scope?: RunScope;
};

export type PiEventPayload = Record<string, unknown>;

export type ArtifactWrittenPayload = {
	sha256: string;
	kind: string;
};

export type RunDonePayload = {
	resultText: string;
	stats: Record<string, unknown>;
	artifacts: string[];
};

export type RunFailedPayload = {
	error: string;
};

export type RunStartedEvent = {
	runId: string;
	seq: number;
	t: string;
	kind: "run_started";
	payload: RunStartedPayload;
};

export type PiEvent = {
	runId: string;
	seq: number;
	t: string;
	kind: "pi_event";
	payload: PiEventPayload;
};

export type ArtifactWrittenEvent = {
	runId: string;
	seq: number;
	t: string;
	kind: "artifact_written";
	payload: ArtifactWrittenPayload;
};

export type RunDoneEvent = {
	runId: string;
	seq: number;
	t: string;
	kind: "run_done";
	payload: RunDonePayload;
};

export type RunFailedEvent = {
	runId: string;
	seq: number;
	t: string;
	kind: "run_failed";
	payload: RunFailedPayload;
};

export type RunEvent =
	| RunStartedEvent
	| PiEvent
	| ArtifactWrittenEvent
	| RunDoneEvent
	| RunFailedEvent;

export type TerminalRunEvent = RunDoneEvent | RunFailedEvent;

export type ActorSpec = {
	actorId: string;
	name: string;
	workspaceId?: string;
	memRef?: string;
};

export type MailboxPost = {
	kind: MailboxKind;
	text: string;
	attachments: ActorArtifactRef[];
	dedupeKey?: string;
	metadata?: Record<string, unknown>;
};

export type ActorState = {
	actorId: string;
	name: string;
	status: ActorStatus;
	mailboxCursor: number;
	updatedAt: string;
};

export type ActorEvent = {
	actorId: string;
	seq: number;
	t: string;
	kind: ActorEventKind;
	payload: Record<string, unknown>;
};
