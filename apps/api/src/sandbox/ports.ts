export const SANDBOX_BACKENDS = ["docker"] as const;
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

export type SandboxBackend = (typeof SANDBOX_BACKENDS)[number];
export type SandboxState = (typeof SANDBOX_STATES)[number];
export type SandboxMountKind = (typeof SANDBOX_MOUNT_KINDS)[number];
export type SandboxMountMode = (typeof SANDBOX_MOUNT_MODES)[number];
export type SandboxNetworkPolicy =
	(typeof SANDBOX_NETWORK_POLICIES)[number];
export type SandboxDestroyMode = (typeof SANDBOX_DESTROY_MODES)[number];

export type SandboxArtifactPointer = {
	sha256: string;
};

export type SandboxMountSpec = {
	kind: SandboxMountKind;
	dest: string;
	mode: SandboxMountMode;
	artifacts?: SandboxArtifactPointer[] | undefined;
};

export type SandboxSpec = {
	sandboxId: string;
	imageDigest: string;
	workdir: string;
	mounts: SandboxMountSpec[];
	env: Record<string, string>;
	network: SandboxNetworkPolicy;
	cpuMillicores: number;
	memoryMb: number;
	diskMb: number;
	timeoutSec: number;
	maxBytesOut: number;
};

export type SandboxHandle = {
	sandboxId: string;
	backend: SandboxBackend;
	state: SandboxState;
	workspaceRef?: SandboxArtifactPointer | undefined;
	lastSeenAt: string;
};

export type ExecSpec = {
	cmd: string[];
	cwd: string;
	stdinText?: string | undefined;
	stream: boolean;
	timeoutSec: number;
	maxBytesOut: number;
};

export type ExecResult = {
	exitCode: number;
	stdoutRef?: SandboxArtifactPointer | undefined;
	stderrRef?: SandboxArtifactPointer | undefined;
	workspaceRef?: SandboxArtifactPointer | undefined;
	startedAt: string;
	endedAt: string;
};

export type SnapshotRule = {
	include: string[];
	exclude: string[];
};

export interface RunnerBackend {
	ensure(spec: SandboxSpec): Promise<SandboxHandle>;
	exec(handle: SandboxHandle, spec: ExecSpec): Promise<ExecResult>;
	snapshot(
		handle: SandboxHandle,
		rule: SnapshotRule,
	): Promise<SandboxArtifactPointer>;
	destroy(
		handle: SandboxHandle,
		mode: SandboxDestroyMode,
	): Promise<SandboxHandle | null>;
}
