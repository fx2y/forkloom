import { DBOS } from "@dbos-inc/dbos-sdk";
import type {
	RunDonePayload,
	RunEvent,
	RunFailedPayload,
	RunStartedPayload,
	RunState,
} from "@forkloom/contracts";
import type { RunEventKind, RunEventPayloadMap } from "./event";
import type { RunEventModel, RunModel, RunRepo, RunSpecModel } from "./ports";
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
 * Call bind() after registerRunOnceWorkflow returns.
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
			throw new Error("RunOnce workflow is not registered");
		}
		return this.inner.startRunOnce(runId, opts);
	}
}

export type RunServiceDeps = {
	runRepo: RunRepo;
	workflowLauncher: RunWorkflowLauncher;
};

function normalizeErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return String(error);
}

export class RunService {
	constructor(private readonly deps: RunServiceDeps) {}

	async startRun(
		spec: RunSpecModel,
	): Promise<{ run: RunModel; created: boolean }> {
		const runId = spec.runId;
		const created = await this.deps.runRepo.createRun({ runId, spec });
		let run = created.run;
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

	async getRunState(runId: string): Promise<RunState | null> {
		const run = await this.deps.runRepo.getRun(runId);
		if (!run) {
			return null;
		}
		const artifacts = await this.deps.runRepo.listArtifacts(runId);
		return toRunStateContract(run, artifacts);
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

	async beginRun(
		runId: string,
		payload: RunStartedPayload = {},
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
		return this.appendLifecycleEvent(runId, "pi_event", payload);
	}

	async appendArtifactWritten(
		runId: string,
		payload: RunEventPayloadMap["artifact_written"],
	): Promise<RunEventModel> {
		return this.appendLifecycleEvent(runId, "artifact_written", payload);
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

	private async appendLifecycleEvent(
		runId: string,
		kind: RunEventKind,
		payload: RunEventPayloadMap[RunEventKind],
	): Promise<RunEventModel> {
		return this.deps.runRepo.appendEvent({
			runId,
			kind,
			payload,
		});
	}
}
