import type {
	ArtifactWrittenPayload,
	RunDonePayload,
	RunFailedPayload,
	RunStartedPayload,
} from "@forkloom/contracts";

export const RUN_EVENT_KINDS = [
	"run_started",
	"run_previewed",
	"run_approval_required",
	"run_approved",
	"run_command_queued",
	"pi_event",
	"artifact_written",
	"workspace_updated",
	"run_aborted",
	"run_done",
	"run_failed",
] as const;

export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

export const RUN_TERMINAL_EVENT_KINDS = [
	"run_done",
	"run_aborted",
	"run_failed",
] as const;

export type RunTerminalEventKind = (typeof RUN_TERMINAL_EVENT_KINDS)[number];

export type RunEventPayloadMap = {
	run_started: RunStartedPayload;
	run_previewed: {
		preview: Record<string, unknown>;
	};
	run_approval_required: {
		profile: string;
	};
	run_approved: {
		seq: number;
	};
	run_command_queued: {
		seq: number;
		kind: string;
	};
	pi_event: Record<string, unknown>;
	artifact_written: ArtifactWrittenPayload;
	workspace_updated: {
		workspaceRef: { sha256: string };
	};
	run_aborted: {
		seq: number;
	};
	run_done: RunDonePayload;
	run_failed: RunFailedPayload;
};

export function isTerminalRunEventKind(
	kind: RunEventKind,
): kind is RunTerminalEventKind {
	return RUN_TERMINAL_EVENT_KINDS.includes(kind as RunTerminalEventKind);
}
