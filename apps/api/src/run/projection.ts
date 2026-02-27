import type { RunEvent, RunState } from "@forkloom/contracts";
import type {
	RunArtifactLinkModel,
	RunEventModel,
	RunModel,
} from "./ports";

export function toRunEventContract(event: RunEventModel): RunEvent {
	return {
		runId: event.runId,
		seq: event.eventId,
		t: event.createdAt,
		kind: event.kind,
		payload: event.payload,
	};
}

export function toRunStateContract(
	run: RunModel,
	artifacts: RunArtifactLinkModel[],
): RunState {
	const state: RunState = {
		runId: run.runId,
		status: run.status,
		startedAt: run.createdAt,
		dbosWfId: run.dbosWorkflowId ?? run.runId,
		artifacts: artifacts.map((artifact) => ({ sha256: artifact.sha256 })),
	};

	if (run.status === "done" || run.status === "failed") {
		state.finishedAt = run.updatedAt;
	}
	if (run.piSessionId) {
		state.piSessionId = run.piSessionId;
	}
	if (run.piSessionFile) {
		state.piSessionFile = run.piSessionFile;
	}

	return state;
}
