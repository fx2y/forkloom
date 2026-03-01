export const RUN_API_ENDPOINTS = [
	"POST /runs",
	"GET /runs/:runId",
	"GET /runs/:runId/truth",
	"GET /runs/:runId/events",
	"POST /runs/:runId/commands",
	"GET /runs/:runId/files",
	"POST /runs/:runId/files/export",
] as const;

export const RUN_PUBLIC_TOP_LEVEL_NOUNS = [
	"RunSpec",
	"RunState",
	"RunEvent",
	"TruthBundle",
] as const;

export const RUN_PUBLIC_COMMAND_KINDS = [
	"approve",
	"prompt",
	"followUp",
	"steer",
	"abort",
] as const;

export const RUN_PUBLIC_STATUSES_FROZEN_NEXT = [
	"awaiting_approval",
	"aborted",
] as const;

export const RUN_PUBLIC_EVENT_KINDS_FROZEN_NEXT = [
	"run_previewed",
	"run_approval_required",
	"run_approved",
	"run_command_queued",
	"run_aborted",
	"workspace_updated",
] as const;

export const RUN_PUBLIC_STATE_FIELDS_FROZEN_NEXT = [
	"preview",
	"approval",
	"currentCommand",
	"files",
] as const;

export const RUN_PUBLIC_BANNED_SANDBOX_NOUNS = [
	"SandboxSpec",
	"SandboxState",
	"SandboxEvent",
	"SandboxCommand",
] as const;

export const RUN_PUBLIC_OWNERSHIP_NOTE = [
	"run owns public preview/state/commands/files",
	"sandbox stays internal and owns compute/workspace/exec",
	"actor queue and lease law are reuse-only, not public nouns",
] as const;
