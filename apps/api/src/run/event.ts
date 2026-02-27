import type {
	ArtifactWrittenPayload,
	RunDonePayload,
	RunFailedPayload,
	RunStartedPayload,
} from "@forkloom/contracts";

export const RUN_EVENT_KINDS = [
	"run_started",
	"pi_event",
	"artifact_written",
	"run_done",
	"run_failed",
] as const;

export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];

export const RUN_TERMINAL_EVENT_KINDS = ["run_done", "run_failed"] as const;

export type RunTerminalEventKind = (typeof RUN_TERMINAL_EVENT_KINDS)[number];

export type RunEventPayloadMap = {
	run_started: RunStartedPayload;
	pi_event: Record<string, unknown>;
	artifact_written: ArtifactWrittenPayload;
	run_done: RunDonePayload;
	run_failed: RunFailedPayload;
};

export function isTerminalRunEventKind(
	kind: RunEventKind,
): kind is RunTerminalEventKind {
	return RUN_TERMINAL_EVENT_KINDS.includes(kind as RunTerminalEventKind);
}
