export const RUN_API_ENDPOINTS = [
	"POST /runs",
	"GET /runs/:runId",
	"GET /runs/:runId/truth",
	"GET /runs/:runId/events",
	"POST /runs/:runId/commands",
	"GET /runs/:runId/skills",
	"POST /runs/:runId/skills/preview",
	"POST /runs/:runId/doc/ingest",
	"POST /runs/:runId/doc/search",
	"POST /runs/:runId/doc/resolve",
	"GET /runs/:runId/files",
	"POST /runs/:runId/files/export",
] as const;

export const RUN_SKILL_API_ENDPOINTS_FROZEN_NEXT = [
	"GET /runs/:runId/skills",
	"POST /runs/:runId/skills/preview",
] as const;

export const RUN_SKILL_UI_ALIASES = ["/skills", "/skill:<name>"] as const;

export const RUN_SKILL_EXECUTION_SURFACE_NOTE = [
	"GET /runs/:runId/skills is metadata-only list/read",
	"POST /runs/:runId/skills/preview is read-only WILL-RUN introspection",
	"explicit skill execution stays inside POST /runs/:runId/commands text payloads",
	"/skills and /skill:<name> are UI aliases only, never top-level HTTP routes",
] as const;

export const RUN_PUBLIC_TOP_LEVEL_NOUNS = [
	"RunSpec",
	"RunState",
	"RunEvent",
	"TruthBundle",
	"SpanRef",
	"RunDocSearch",
	"RunDocResolve",
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
	"doc ingest/search/resolve stay nested under /runs and reuse run-owned contracts",
	"skill list/preview stay nested under /runs; /skills and /skill:<name> are UI-only aliases",
	"sandbox stays internal and owns compute/workspace/exec",
	"actor queue and lease law are reuse-only, not public nouns",
] as const;
