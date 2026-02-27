import type {
	ArtifactWrittenPayload,
	PiEventPayload,
	RunDonePayload,
	RunEvent,
	RunFailedPayload,
	RunStartedPayload,
	RunState,
} from "@forkloom/contracts";
import type { RunArtifactLinkModel, RunEventModel, RunModel } from "./ports";

export function toRunEventContract(event: RunEventModel): RunEvent {
	const base = {
		runId: event.runId,
		seq: event.eventId,
		t: event.createdAt,
	};
	switch (event.kind) {
		case "run_started":
			return {
				...base,
				kind: event.kind,
				payload: event.payload as RunStartedPayload,
			};
		case "pi_event":
			return {
				...base,
				kind: event.kind,
				payload: event.payload as PiEventPayload,
			};
		case "artifact_written":
			return {
				...base,
				kind: event.kind,
				payload: event.payload as ArtifactWrittenPayload,
			};
		case "run_done":
			return {
				...base,
				kind: event.kind,
				payload: event.payload as RunDonePayload,
			};
		case "run_failed":
			return {
				...base,
				kind: event.kind,
				payload: event.payload as RunFailedPayload,
			};
	}
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
