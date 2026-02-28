import type {
	ArtifactWrittenPayload,
	PiEventPayload,
	RunDonePayload,
	RunEvent,
	RunFailedPayload,
	RunStartedPayload,
	RunState,
} from "@forkloom/contracts";
import type { RunCommandModel, SandboxModel } from "../sandbox";
import type { RunArtifactLinkModel, RunEventModel, RunModel } from "./ports";

type ProjectedRunState = RunState & {
	preview?: Record<string, unknown> | undefined;
	approval?: Record<string, unknown> | undefined;
	currentCommand?: Record<string, unknown> | undefined;
	files?: Record<string, unknown> | undefined;
};

function asRunEvent(event: Record<string, unknown>): RunEvent {
	return event as unknown as RunEvent;
}

function toPublicPreview(sandbox: SandboxModel): Record<string, unknown> {
	return {
		imageDigest: sandbox.previewSpec.imageDigest,
		profile: sandbox.previewSpec.profile,
		network: sandbox.previewSpec.network,
		workdir: sandbox.previewSpec.workdir,
		timeoutSec: sandbox.previewSpec.timeoutSec,
		maxBytesOut: sandbox.previewSpec.maxBytesOut,
		mounts: sandbox.previewSpec.mounts.map((mount) => ({
			dest: mount.dest,
			mode: mount.mode,
			kind: mount.kind,
		})),
	};
}

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
		case "run_previewed":
		case "run_approval_required":
		case "run_approved":
		case "run_command_queued":
		case "workspace_updated":
		case "run_aborted":
			return asRunEvent({
				...base,
				kind: event.kind,
				payload: event.payload,
			});
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
	extra?: {
		sandbox?: SandboxModel | undefined;
		currentCommand?: RunCommandModel | null | undefined;
		files?:
			| {
					workspaceRef?: { sha256: string } | undefined;
					workspace_manifest: {
						version: 1;
						entries: Array<{ path: string; bytes: number; sha256: string }>;
					};
			  }
			| undefined;
	},
): RunState {
	const state: ProjectedRunState = {
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
	if (extra?.sandbox) {
		state.preview = toPublicPreview(extra.sandbox);
		state.approval = {
			required: extra.sandbox.approvalState !== "not_required",
			state: extra.sandbox.approvalState,
		};
	}
	if (extra?.currentCommand) {
		state.currentCommand = {
			seq: extra.currentCommand.seq,
			kind: extra.currentCommand.kind,
			state: extra.currentCommand.state,
		};
	}
	if (extra?.files) {
		state.files = {
			workspaceRef: extra.files.workspaceRef,
			entries: extra.files.workspace_manifest.entries,
		};
	}

	return state;
}
