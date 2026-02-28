export const SANDBOX_BACKENDS = ["docker"] as const;
export const SANDBOX_PROFILES = ["safe", "std", "priv"] as const;
export const SANDBOX_STATES = [
	"missing",
	"ready",
	"sleeping",
	"recreating",
	"failed",
] as const;
export const SANDBOX_MOUNT_KINDS = ["work", "inputs", "cache"] as const;
export const SANDBOX_MOUNT_MODES = ["rw", "ro"] as const;
export const SANDBOX_NETWORK_POLICIES = ["off", "egress"] as const;
export const SANDBOX_DESTROY_MODES = ["sleep", "delete"] as const;
export const SANDBOX_APPROVAL_STATES = [
	"not_required",
	"pending",
	"approved",
] as const;
export const RUN_COMMAND_KINDS = [
	"prompt",
	"followUp",
	"steer",
	"abort",
	"approve",
] as const;
export const RUN_COMMAND_STATES = ["queued", "claimed", "done", "dead"] as const;
export const SANDBOX_EXEC_STATUSES = [
	"running",
	"done",
	"failed",
	"aborted",
] as const;

export type SandboxBackend = (typeof SANDBOX_BACKENDS)[number];
export type SandboxProfile = (typeof SANDBOX_PROFILES)[number];
export type SandboxState = (typeof SANDBOX_STATES)[number];
export type SandboxMountKind = (typeof SANDBOX_MOUNT_KINDS)[number];
export type SandboxMountMode = (typeof SANDBOX_MOUNT_MODES)[number];
export type SandboxNetworkPolicy =
	(typeof SANDBOX_NETWORK_POLICIES)[number];
export type SandboxDestroyMode = (typeof SANDBOX_DESTROY_MODES)[number];
export type SandboxApprovalState = (typeof SANDBOX_APPROVAL_STATES)[number];
export type RunCommandKind = (typeof RUN_COMMAND_KINDS)[number];
export type RunCommandState = (typeof RUN_COMMAND_STATES)[number];
export type SandboxExecStatus = (typeof SANDBOX_EXEC_STATUSES)[number];

export type SandboxArtifactPointer = {
	sha256: string;
};

export type SandboxMountSpec = {
	kind: SandboxMountKind;
	source: string;
	dest: string;
	mode: SandboxMountMode;
	artifacts?: SandboxArtifactPointer[] | undefined;
};

export type SandboxSpecModel = {
	runId: string;
	sandboxId: string;
	profile: SandboxProfile;
	backend: SandboxBackend;
	imageDigest: string;
	containerName: string;
	workVolume: string;
	workdir: string;
	piHomeHostDir: string;
	piHomePath: string;
	mounts: SandboxMountSpec[];
	env: Record<string, string>;
	network: SandboxNetworkPolicy;
	cpuMillicores: number;
	memoryMb: number;
	diskMb: number;
	timeoutSec: number;
	maxBytesOut: number;
};

export type SandboxPreviewModel = {
	imageDigest: string;
	profile: SandboxProfile;
	network: SandboxNetworkPolicy;
	containerName: string;
	workVolume: string;
	workdir: string;
	timeoutSec: number;
	maxBytesOut: number;
	mounts: Array<{
		source: string;
		dest: string;
		mode: SandboxMountMode;
		kind: SandboxMountKind;
	}>;
};

export type SandboxModel = {
	runId: string;
	sandboxId: string;
	backend: SandboxBackend;
	profile: SandboxProfile;
	state: SandboxState;
	approvalState: SandboxApprovalState;
	spec: SandboxSpecModel;
	previewSpec: SandboxPreviewModel;
	containerName: string;
	workVolume: string;
	inflightWorkflowId: string | null;
	leaseExpiresAt: string | null;
	workspaceRef?: SandboxArtifactPointer | undefined;
	createdAt: string;
	updatedAt: string;
	lastSeenAt: string;
};

export type ExecSpec = {
	cmd: string[];
	cwd: string;
	env?: Record<string, string> | undefined;
	stdinText?: string | undefined;
	stream: boolean;
	timeoutSec: number;
	maxBytesOut: number;
};

export type ExecResult = {
	exitCode: number;
	status: SandboxExecStatus;
	stdoutTail: string;
	stderrTail: string;
	stdoutBytes: number;
	stderrBytes: number;
	timeoutSec: number;
	maxBytesOut: number;
	stdoutRef?: SandboxArtifactPointer | undefined;
	stderrRef?: SandboxArtifactPointer | undefined;
	workspaceRef?: SandboxArtifactPointer | undefined;
	startedAt: string;
	endedAt: string;
};

export type SandboxExecModel = {
	execId: number;
	runId: string;
	commandSeq: number;
	commandKind: RunCommandKind;
	status: SandboxExecStatus;
	exitCode: number | null;
	stdoutTail: string;
	stderrTail: string;
	stdoutBytes: number;
	stderrBytes: number;
	timeoutSec: number;
	maxBytesOut: number;
	stdoutRef?: SandboxArtifactPointer | undefined;
	stderrRef?: SandboxArtifactPointer | undefined;
	workspaceRef?: SandboxArtifactPointer | undefined;
	startedAt: string;
	endedAt: string | null;
};

export type RunCommandModel = {
	runId: string;
	seq: number;
	kind: RunCommandKind;
	payload: Record<string, unknown>;
	dedupeKey: string | null;
	state: RunCommandState;
	claimedBy: string | null;
	claimedAt: string | null;
	leaseExpiresAt: string | null;
	doneAt: string | null;
	error: string | null;
	createdAt: string;
};

export type SnapshotRule = {
	include: string[];
	exclude: string[];
};

export interface RunnerBackend {
	ensure(spec: SandboxSpecModel): Promise<SandboxModel>;
	exec(handle: SandboxModel, spec: ExecSpec): Promise<ExecResult>;
	snapshot(
		handle: SandboxModel,
		rule: SnapshotRule,
	): Promise<SandboxArtifactPointer>;
	destroy(
		handle: SandboxModel,
		mode: SandboxDestroyMode,
	): Promise<SandboxModel | null>;
}

export interface SandboxRepo {
	createSandbox(input: {
		runId: string;
		spec: SandboxSpecModel;
		previewSpec: SandboxPreviewModel;
	}): Promise<{ sandbox: SandboxModel; created: boolean }>;
	getSandbox(runId: string): Promise<SandboxModel | null>;
	queueCommand(input: {
		runId: string;
		kind: RunCommandKind;
		payload: Record<string, unknown>;
		dedupeKey?: string | undefined;
	}): Promise<{
		command: RunCommandModel;
		created: boolean;
		firstPendingSeq: number | null;
	}>;
	acquireLease(input: {
		runId: string;
		workflowId: string;
		leaseMs: number;
	}): Promise<boolean>;
	claimNextCommand(input: {
		runId: string;
		workflowId: string;
	}): Promise<RunCommandModel | null>;
	persistExec(input: {
		runId: string;
		workflowId: string;
		commandSeq: number;
		commandKind: RunCommandKind;
		result: ExecResult;
		workspaceRef?: SandboxArtifactPointer | undefined;
		sandboxState?: SandboxState | undefined;
	}): Promise<{
		exec: SandboxExecModel;
		sandbox: SandboxModel;
		nextPendingSeq: number | null;
	}>;
	markCommandDead(input: {
		runId: string;
		workflowId: string;
		commandSeq: number;
		error: string;
	}): Promise<number | null>;
	releaseLease(runId: string, workflowId: string): Promise<void>;
	markApproved(runId: string): Promise<SandboxModel | null>;
	listExecs(runId: string): Promise<SandboxExecModel[]>;
}
