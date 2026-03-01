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

export const ACTOR_TICK_WORKFLOW_STEPS = [
	"acquire_lock",
	"claim_batch",
	"load_actor",
	"ensure_session",
	"apply_batch",
	"persist_batch",
	"mark_batch",
	"release_lock",
] as const;

export type ActorTickWorkflowStep = (typeof ACTOR_TICK_WORKFLOW_STEPS)[number];

export { executeRunOnce, registerRunOnceWorkflow } from "./runonce";
export type { RunOnceDeps } from "./runonce";
export const RUN_SANDBOX_WORKFLOW_STEPS = [
	"loadPlan",
	"ensureSandbox",
	"stageInputs",
	"ensurePi",
	"applyCommand",
	"collect",
	"snapshot",
	"release",
] as const;
export type RunSandboxWorkflowStep =
	(typeof RUN_SANDBOX_WORKFLOW_STEPS)[number];
export { executeRunSandbox, registerRunSandboxWorkflow } from "./run-sandbox";
export type { RunSandboxDeps } from "./run-sandbox";
export type { ReplayConfig, ReplayMode, ReplayStepPayload } from "./replay";
export { executeActorTick, registerActorTickWorkflow } from "./actor-tick";
export type {
	ActorTickDeps,
	RegisteredActorWorkflow,
} from "./actor-tick";
