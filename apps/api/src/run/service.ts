import { DBOS } from "@dbos-inc/dbos-sdk";
import type { RunEvent, RunState } from "@forkloom/contracts";
import type { RunEventKind } from "./event";
import type { RunEventModel, RunModel, RunRepo, RunSpecModel } from "./ports";
import { toRunEventContract, toRunStateContract } from "./projection";

export type RunDonePayload = {
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
		const created = await this.deps.runRepo.createRun({
			runId,
			workflowId: runId,
			spec,
		});

		if (created.created) {
			await this.deps.workflowLauncher.startRunOnce(runId, {
				workflowID: runId,
			});
		}

		return created;
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

	async appendRunStarted(
		runId: string,
		payload: Record<string, unknown> = {},
	): Promise<RunEventModel> {
		return this.appendLifecycleEvent(runId, "run_started", payload);
	}

	async appendPiEvent(
		runId: string,
		payload: Record<string, unknown>,
	): Promise<RunEventModel> {
		return this.appendLifecycleEvent(runId, "pi_event", payload);
	}

	async appendArtifactWritten(
		runId: string,
		payload: Record<string, unknown>,
	): Promise<RunEventModel> {
		return this.appendLifecycleEvent(runId, "artifact_written", payload);
	}

	async completeRun(
		runId: string,
		payload: RunDonePayload,
	): Promise<RunModel | null> {
		const updated = await this.deps.runRepo.markDone({
			runId,
			resultText: payload.resultText,
			resultStats: payload.stats,
			piSessionId: payload.piSessionId,
			piSessionFile: payload.piSessionFile,
		});

		await this.appendLifecycleEvent(runId, "run_done", {
			text: payload.resultText,
			stats: payload.stats,
			artifacts: payload.artifacts,
		});

		return updated;
	}

	async failRun(runId: string, error: unknown): Promise<RunModel | null> {
		const message = normalizeErrorMessage(error);
		const updated = await this.deps.runRepo.markFailed(runId, message);
		await this.appendLifecycleEvent(runId, "run_failed", { error: message });
		return updated;
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
		payload: Record<string, unknown>,
	): Promise<RunEventModel> {
		return this.deps.runRepo.appendEvent({
			runId,
			kind,
			payload,
		});
	}
}
