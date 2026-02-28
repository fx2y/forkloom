import { DBOS } from "@dbos-inc/dbos-sdk";
import type {
	RunDonePayload,
	RunEvent,
	RunFailedPayload,
	RunState,
} from "@forkloom/contracts";
import {
	exportWorkspaceFiles,
	listWorkspaceFiles,
	type RunCommandKind,
	type RunCommandModel,
	type SandboxModel,
	type SandboxRepo,
} from "../sandbox";
import type { ArtifactService } from "../service";
import { toRunSandboxWorkflowId } from "../workflow/run-sandbox";
import type { RunEventKind, RunEventPayloadMap } from "./event";
import type { RunEventModel, RunModel, RunRepo, RunSpecModel } from "./ports";
import { type RunPlan } from "./plan";
import { toRunEventContract, toRunStateContract } from "./projection";

export type CompleteRunInput = {
	resultText: string;
	stats: Record<string, unknown>;
	artifacts: string[];
	piSessionId: string;
	piSessionFile: string;
};

export interface RunWorkflowLauncher {
	startRunOnce(runId: string, opts: { workflowID: string }): Promise<void>;
}

export type RegisteredRunWorkflow = (runId: string) => Promise<void>;

export class DbosRunWorkflowLauncher implements RunWorkflowLauncher {
	constructor(private readonly workflow: RegisteredRunWorkflow) {}

	async startRunOnce(
		runId: string,
		opts: { workflowID: string },
	): Promise<void> {
		await DBOS.startWorkflow(this.workflow, opts)(runId);
	}
}

/**
 * Late-bound launcher that breaks the RunService↔workflow circular dep.
 * Call bind() after the target workflow is registered.
 */
export class LazyDbosRunWorkflowLauncher implements RunWorkflowLauncher {
	private inner: RunWorkflowLauncher | null = null;

	bind(workflow: RegisteredRunWorkflow): void {
		this.inner = new DbosRunWorkflowLauncher(workflow);
	}

	async startRunOnce(
		runId: string,
		opts: { workflowID: string },
	): Promise<void> {
		if (!this.inner) {
			throw new Error("Run workflow is not registered");
		}
		return this.inner.startRunOnce(runId, opts);
	}
}

type SandboxDeps = {
	sandboxRepo: Pick<
		SandboxRepo,
		| "createSandbox"
		| "getSandbox"
		| "getCurrentCommand"
		| "listExecs"
		| "markApproved"
		| "queueCommand"
	>;
	createRunPlan(spec: RunSpecModel): RunPlan;
	artifactService: Pick<
		ArtifactService,
		"getArtifactBytes" | "getArtifactMeta" | "putArtifact"
	>;
};

export type RunServiceDeps = {
	runRepo: RunRepo;
	workflowLauncher: RunWorkflowLauncher;
	sandbox?: SandboxDeps | undefined;
};

export type StartRunResult = {
	run: RunModel;
	created: boolean;
	sandbox?: SandboxModel | undefined;
	command?: RunCommandModel | undefined;
};

function normalizeErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return String(error);
}

function usesSandbox(spec: RunSpecModel, deps: RunServiceDeps): boolean {
	return spec.profile != null && deps.sandbox != null;
}

export class RunService {
	constructor(private readonly deps: RunServiceDeps) {}

	async startRun(spec: RunSpecModel): Promise<StartRunResult> {
		const runId = spec.runId;
		const created = await this.deps.runRepo.createRun({ runId, spec });
		let run = created.run;

		if (!usesSandbox(spec, this.deps)) {
			if (run.status === "queued" && run.dbosWorkflowId === null) {
				await this.deps.workflowLauncher.startRunOnce(runId, {
					workflowID: runId,
				});
				run =
					(await this.deps.runRepo.recordWorkflowLaunch(runId, runId)) ??
					created.run;
			}
			return { run, created: created.created };
		}

		const sandboxDeps = this.requireSandboxDeps();
		const plan = sandboxDeps.createRunPlan(spec);
		const persistedSandbox = await sandboxDeps.sandboxRepo.createSandbox({
			runId,
			spec: plan.sandboxSpec,
			previewSpec: plan.previewSpec,
		});
		if (persistedSandbox.created) {
			await this.appendRunEvent(runId, "run_previewed", {
				preview: plan.previewSpec,
			});
		}
		if (
			persistedSandbox.created &&
			persistedSandbox.sandbox.approvalState === "pending"
		) {
			await this.appendRunEvent(runId, "run_approval_required", {
				profile: persistedSandbox.sandbox.profile,
			});
		}
		const queued = await sandboxDeps.sandboxRepo.queueCommand({
			runId,
			kind: plan.initialCommand.kind,
			payload: plan.initialCommand.payload,
			dedupeKey: plan.initialCommand.dedupeKey,
		});
		if (queued.created) {
			await this.appendRunEvent(runId, "run_command_queued", {
				seq: queued.command.seq,
				kind: queued.command.kind,
			});
		}
		if (
			persistedSandbox.sandbox.approvalState !== "pending" &&
			queued.firstPendingSeq != null
		) {
			const workflowID = toRunSandboxWorkflowId(runId, queued.firstPendingSeq);
			await this.deps.workflowLauncher.startRunOnce(runId, { workflowID });
			run =
				(await this.deps.runRepo.recordWorkflowLaunch(runId, workflowID)) ??
				created.run;
		}

		return {
			run,
			created: created.created,
			sandbox: persistedSandbox.sandbox,
			command: queued.command,
		};
	}

	async queueCommand(input: {
		runId: string;
		kind: RunCommandKind;
		payload?: Record<string, unknown> | undefined;
		dedupeKey?: string | undefined;
	}): Promise<{ command: RunCommandModel; created: boolean }> {
		const sandboxDeps = this.requireSandboxDeps();
		const sandbox = await sandboxDeps.sandboxRepo.getSandbox(input.runId);
		if (!sandbox) {
			throw new Error(`run sandbox not found: ${input.runId}`);
		}
		if (sandbox.approvalState === "pending" && input.kind !== "approve") {
			throw new Error("run requires approve before interactive commands");
		}
		const queued = await sandboxDeps.sandboxRepo.queueCommand({
			runId: input.runId,
			kind: input.kind,
			payload: input.payload ?? {},
			dedupeKey: input.dedupeKey,
		});
		if (queued.created) {
			await this.appendRunEvent(input.runId, "run_command_queued", {
				seq: queued.command.seq,
				kind: queued.command.kind,
			});
		}
		if (queued.firstPendingSeq != null) {
			await this.deps.workflowLauncher.startRunOnce(input.runId, {
				workflowID: toRunSandboxWorkflowId(input.runId, queued.firstPendingSeq),
			});
		}
		return {
			command: queued.command,
			created: queued.created,
		};
	}

	async getRunState(runId: string): Promise<RunState | null> {
		const run = await this.deps.runRepo.getRun(runId);
		if (!run) {
			return null;
		}
		const artifacts = await this.deps.runRepo.listArtifacts(runId);
		const sandboxDeps = this.deps.sandbox;
		if (!sandboxDeps) {
			return toRunStateContract(run, artifacts);
		}
		const sandbox = await sandboxDeps.sandboxRepo.getSandbox(runId);
		if (!sandbox) {
			return toRunStateContract(run, artifacts);
		}
		const currentCommand = await sandboxDeps.sandboxRepo.getCurrentCommand(runId);
		const files =
			sandbox.workspaceRef != null
				? await listWorkspaceFiles({
						workspaceRef: sandbox.workspaceRef,
						artifactService: sandboxDeps.artifactService,
					})
				: undefined;
		return toRunStateContract(run, artifacts, {
			sandbox,
			currentCommand,
			files,
		});
	}

	async listRunEvents(
		runId: string,
		sinceEventId: number,
		limit: number,
	): Promise<RunEvent[]> {
		const events = await this.deps.runRepo.listEventsSince(
			runId,
			sinceEventId,
			limit,
		);
		return events.map(toRunEventContract);
	}

	async listFiles(runId: string): Promise<{
		workspaceRef?: { sha256: string } | undefined;
		workspace_manifest: {
			version: 1;
			entries: Array<{ path: string; bytes: number; sha256: string }>;
		};
	}> {
		const sandboxDeps = this.requireSandboxDeps();
		const sandbox = await sandboxDeps.sandboxRepo.getSandbox(runId);
		if (!sandbox) {
			throw new Error(`run sandbox not found: ${runId}`);
		}
		if (!sandbox.workspaceRef) {
			return {
				workspace_manifest: {
					version: 1,
					entries: [],
				},
			};
		}
		return listWorkspaceFiles({
			workspaceRef: sandbox.workspaceRef,
			artifactService: sandboxDeps.artifactService,
		});
	}

	async exportFiles(input: {
		runId: string;
		paths?: string[] | undefined;
	}): Promise<{
		workspace_export: { sha256: string };
		workspace_manifest: {
			version: 1;
			entries: Array<{ path: string; bytes: number; sha256: string }>;
		};
	}> {
		const sandboxDeps = this.requireSandboxDeps();
		const sandbox = await sandboxDeps.sandboxRepo.getSandbox(input.runId);
		if (!sandbox?.workspaceRef) {
			throw new Error(`workspace snapshot not found: ${input.runId}`);
		}
		const exported = await exportWorkspaceFiles({
			runId: input.runId,
			workspaceRef: sandbox.workspaceRef,
			paths: input.paths,
			artifactService: sandboxDeps.artifactService,
		});
		await this.linkArtifact(
			input.runId,
			exported.workspace_export.sha256,
			"workspace_export",
		);
		await this.appendArtifactWritten(input.runId, {
			sha256: exported.workspace_export.sha256,
			kind: "workspace_export",
		});
		return exported;
	}

	async beginRun(
		runId: string,
		payload: RunEventPayloadMap["run_started"] = {},
	): Promise<RunEventModel> {
		return this.deps.runRepo.beginRun({
			runId,
			workflowId: runId,
			payload,
		});
	}

	async appendPiEvent(
		runId: string,
		payload: RunEventPayloadMap["pi_event"],
	): Promise<RunEventModel> {
		return this.appendRunEvent(runId, "pi_event", payload);
	}

	async appendArtifactWritten(
		runId: string,
		payload: RunEventPayloadMap["artifact_written"],
	): Promise<RunEventModel> {
		return this.appendRunEvent(runId, "artifact_written", payload);
	}

	async appendRunEvent<K extends RunEventKind>(
		runId: string,
		kind: K,
		payload: RunEventPayloadMap[K],
	): Promise<RunEventModel> {
		return this.deps.runRepo.appendEvent({
			runId,
			kind,
			payload,
		});
	}

	async completeRun(
		runId: string,
		payload: CompleteRunInput,
	): Promise<RunModel | null> {
		const eventPayload: RunDonePayload = {
			resultText: payload.resultText,
			stats: payload.stats,
			artifacts: payload.artifacts,
		};
		const updated = await this.deps.runRepo.completeRun({
			runId,
			resultText: payload.resultText,
			resultStats: payload.stats,
			eventPayload,
			piSessionId: payload.piSessionId,
			piSessionFile: payload.piSessionFile,
		});
		return updated.run;
	}

	async failRun(runId: string, error: unknown): Promise<RunModel | null> {
		const message = normalizeErrorMessage(error);
		const eventPayload: RunFailedPayload = { error: message };
		const updated = await this.deps.runRepo.failRun({
			runId,
			error: message,
			eventPayload,
		});
		return updated.run;
	}

	async linkArtifact(
		runId: string,
		sha256: string,
		kind: string,
	): Promise<void> {
		await this.deps.runRepo.linkArtifact({
			runId,
			sha256,
			kind,
		});
	}

	private requireSandboxDeps(): SandboxDeps {
		if (!this.deps.sandbox) {
			throw new Error("sandbox control is not configured");
		}
		return this.deps.sandbox;
	}
}
