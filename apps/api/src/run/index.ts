export const RUN_EVENT_KINDS = [
	"run_started",
	"pi_event",
	"artifact_written",
	"run_done",
	"run_failed",
] as const;

export type RunEventKind = (typeof RUN_EVENT_KINDS)[number];
