export const RUN_WORKFLOW_STEPS = [
	"init_run",
	"stage_inputs",
	"start_pi",
	"prompt_pi",
	"pump_events",
	"finalize",
	"persist_session",
	"mark_done",
] as const;

export type RunWorkflowStep = (typeof RUN_WORKFLOW_STEPS)[number];
