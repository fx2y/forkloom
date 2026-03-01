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
export type RunProfile = "safe" | "std" | "priv";
export type RunStatus =
	| "queued"
	| "awaiting_approval"
	| "running"
	| "done"
	| "failed"
	| "aborted";
export type RunEventKind =
	| "run_started"
	| "run_previewed"
	| "run_approval_required"
	| "run_approved"
	| "run_command_queued"
	| "pi_event"
	| "artifact_written"
	| "workspace_updated"
	| "run_aborted"
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
	profile?: RunProfile;
};

export type RunState = {
	runId: string;
	status: RunStatus;
	startedAt: string;
	finishedAt?: string;
	dbosWfId: string;
	piSessionId?: string;
	piSessionFile?: string;
	preview?: Record<string, unknown>;
	approval?: Record<string, unknown>;
	currentCommand?: Record<string, unknown>;
	files?: Record<string, unknown>;
	artifacts: RunArtifactRef[];
};

export type TruthBundle = {
	run: {
		runId: string;
		status: "queued" | "running" | "done" | "failed";
		spec: RunSpec;
		createdAt: string;
		updatedAt: string;
		dbosWorkflowId: string | null;
		piSessionId: string | null;
		piSessionFile: string | null;
		resultText: string | null;
		resultStats: Record<string, unknown> | null;
		error: string | null;
	};
	steps: Array<{
		runId: string;
		stepName: string;
		attempt: number;
		stepKey: string;
		inHash: string;
		outHash: string | null;
		startedAt: string;
		endedAt: string | null;
	}>;
	links: Array<{
		runId: string;
		stepName: string;
		attempt: number;
		sessionEntryIds: string[];
		artifactShas: string[];
		note: string | null;
		createdAt: string;
	}>;
	artifacts: Array<{
		runId: string;
		sha256: string;
		kind: string;
		createdAt: string;
	}>;
	sessionIndex: {
		runId: string;
		entryCount: number;
		rootId: string | null;
		leafId: string | null;
		summaryEntryCount: number;
		updatedAt: string;
	} | null;
	stepPayloads: Array<{
		runId: string;
		stepName: string;
		attempt: number;
		payload: Record<string, unknown>;
		createdAt: string;
	}>;
};

export type SpanRef = {
	docSha: string;
	parseId: string;
	page: number;
	bbox: [number, number, number, number] | null;
	charStart: number | null;
	charEnd: number | null;
	blockPath: string;
	chunkId: string;
};

export type RunDocSearch = {
	query: string;
	scope: string;
	hits: Array<{
		chunkId: string;
		score: number;
		spans: SpanRef[];
		snippet: string;
	}>;
};

export type RunDocResolve = {
	span: SpanRef;
	md: string;
	bbox: [number, number, number, number] | null;
	pageImageSha: string | null;
};

export type RunStartedPayload = {
	scope?: RunScope;
};

export type RunPreviewedPayload = {
	preview: Record<string, unknown>;
};

export type RunApprovalRequiredPayload = {
	profile: string;
};

export type RunApprovedPayload = {
	seq: number;
};

export type RunCommandQueuedPayload = {
	seq: number;
	kind: string;
};

export type PiEventPayload = Record<string, unknown>;

export type ArtifactWrittenPayload = {
	sha256: string;
	kind: string;
};

export type WorkspaceUpdatedPayload = {
	workspaceRef: RunArtifactRef;
};

export type RunAbortedPayload = {
	seq: number;
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

export type RunPreviewedEvent = {
	runId: string;
	seq: number;
	t: string;
	kind: "run_previewed";
	payload: RunPreviewedPayload;
};

export type RunApprovalRequiredEvent = {
	runId: string;
	seq: number;
	t: string;
	kind: "run_approval_required";
	payload: RunApprovalRequiredPayload;
};

export type RunApprovedEvent = {
	runId: string;
	seq: number;
	t: string;
	kind: "run_approved";
	payload: RunApprovedPayload;
};

export type RunCommandQueuedEvent = {
	runId: string;
	seq: number;
	t: string;
	kind: "run_command_queued";
	payload: RunCommandQueuedPayload;
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

export type WorkspaceUpdatedEvent = {
	runId: string;
	seq: number;
	t: string;
	kind: "workspace_updated";
	payload: WorkspaceUpdatedPayload;
};

export type RunAbortedEvent = {
	runId: string;
	seq: number;
	t: string;
	kind: "run_aborted";
	payload: RunAbortedPayload;
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
	| RunPreviewedEvent
	| RunApprovalRequiredEvent
	| RunApprovedEvent
	| RunCommandQueuedEvent
	| PiEvent
	| ArtifactWrittenEvent
	| WorkspaceUpdatedEvent
	| RunAbortedEvent
	| RunDoneEvent
	| RunFailedEvent;

export type TerminalRunEvent = RunAbortedEvent | RunDoneEvent | RunFailedEvent;

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