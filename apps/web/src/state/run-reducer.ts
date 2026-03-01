import type { RunEvent, RunState, TruthBundle } from "@forkloom/contracts";

export type RunArtifactView = {
	key: string;
	label: string;
	kind: string;
	href?: string | undefined;
};

export type RunTraceView = {
	seq: number;
	kind: RunEvent["kind"];
	detail: string;
};

export type RunProvenance = {
	artifact: string;
	runId: string;
	stepName: string;
	attempt: number;
	sessionIds: string[];
	parentShas: string[];
};

export type RunViewState = {
	run: RunState | null;
	lastEventSeq: number;
	artifacts: RunArtifactView[];
	trace: RunTraceView[];
	provenanceByArtifact: Record<string, RunProvenance[]>;
};

function appendArtifact(
	artifacts: RunArtifactView[],
	artifact: RunArtifactView,
): RunArtifactView[] {
	return artifacts.some((entry) => entry.key === artifact.key)
		? artifacts
		: [...artifacts, artifact];
}

function appendSha(
	artifacts: RunArtifactView[],
	sha256: string,
	kind = "artifact",
): RunArtifactView[] {
	return appendArtifact(artifacts, {
		key: `${kind}:${sha256}`,
		label: sha256.slice(0, 12),
		kind,
		href: `/artifacts/${sha256}`,
	});
}

function toTraceDetail(event: RunEvent): string {
	switch (event.kind) {
		case "run_previewed":
			return "WILL-RUN persisted";
		case "run_approval_required":
			return `approval ${String(event.payload.profile ?? "required")}`;
		case "run_approved":
			return `approved #${String(event.payload.seq ?? "?")}`;
		case "run_command_queued":
			return `${String(event.payload.kind ?? "command")} queued`;
		case "workspace_updated":
			return "workspace snapshot updated";
		case "run_aborted":
			return "run aborted";
		case "run_started":
			return "run started";
		case "run_done":
			return "run done";
		case "run_failed":
			return String(event.payload.error ?? "run failed");
		case "artifact_written":
			return String(event.payload.kind ?? "artifact");
		case "pi_event": {
			const payloadEvent = event.payload.event;
			if (typeof payloadEvent === "object" && payloadEvent !== null) {
				const record = payloadEvent as Record<string, unknown>;
				return String(record.kind ?? record.type ?? "pi_event");
			}
			return "pi_event";
		}
	}
}

function mergeRunState(
	current: RunState | null,
	patch: Partial<RunState>,
): RunState | null {
	if (!current) {
		return null;
	}
	return {
		...current,
		...patch,
	};
}

export const initialRunViewState: RunViewState = {
	run: null,
	lastEventSeq: 0,
	artifacts: [],
	trace: [],
	provenanceByArtifact: {},
};

function appendProvenanceEntry(
	map: Record<string, RunProvenance[]>,
	entry: RunProvenance,
): Record<string, RunProvenance[]> {
	const current = map[entry.artifact] ?? [];
	const dedupeKey = `${entry.stepName}:${entry.attempt}`;
	if (
		current.some(
			(existing) => `${existing.stepName}:${existing.attempt}` === dedupeKey,
		)
	) {
		return map;
	}
	return {
		...map,
		[entry.artifact]: [...current, entry],
	};
}

export function hydrateRunState(
	state: RunViewState,
	run: RunState,
): RunViewState {
	let artifacts = state.artifacts;
	for (const artifact of run.artifacts) {
		artifacts = appendSha(artifacts, artifact.sha256);
	}
	const files = run.files as
		| {
				workspaceRef?: { sha256: string } | undefined;
		  }
		| undefined;
	if (files?.workspaceRef) {
		artifacts = appendSha(artifacts, files.workspaceRef.sha256, "workspace");
	}
	return {
		...state,
		run,
		artifacts,
	};
}

export function hydrateRunTruth(
	state: RunViewState,
	truth: TruthBundle,
): RunViewState {
	let artifacts = state.artifacts;
	for (const artifact of truth.artifacts) {
		artifacts = appendSha(artifacts, artifact.sha256, artifact.kind);
	}
	let provenanceByArtifact = state.provenanceByArtifact;
	for (const link of truth.links) {
		for (const artifactSha of link.artifactShas) {
			provenanceByArtifact = appendProvenanceEntry(provenanceByArtifact, {
				artifact: artifactSha,
				runId: truth.run.runId,
				stepName: link.stepName,
				attempt: link.attempt,
				sessionIds: [...link.sessionEntryIds],
				parentShas: link.artifactShas.filter((sha) => sha !== artifactSha),
			});
		}
	}
	return {
		...state,
		artifacts,
		provenanceByArtifact,
	};
}

export function reduceRunEvent(
	state: RunViewState,
	event: RunEvent,
): RunViewState {
	if (event.seq <= state.lastEventSeq) {
		return state;
	}

	let run = state.run;
	let artifacts = state.artifacts;
	if (
		event.kind === "artifact_written" &&
		typeof event.payload.sha256 === "string"
	) {
		artifacts = appendSha(
			artifacts,
			event.payload.sha256,
			String(event.payload.kind ?? "artifact"),
		);
	}
	if (
		event.kind === "workspace_updated" &&
		typeof event.payload.workspaceRef?.sha256 === "string"
	) {
		artifacts = appendSha(
			artifacts,
			event.payload.workspaceRef.sha256,
			"workspace",
		);
	}

	switch (event.kind) {
		case "run_previewed":
			run = mergeRunState(run, { preview: event.payload.preview });
			break;
		case "run_approval_required":
			run = mergeRunState(run, {
				status: "awaiting_approval",
				approval: {
					required: true,
					state: "pending",
				},
			});
			break;
		case "run_approved":
			run = mergeRunState(run, {
				approval: {
					required: true,
					state: "approved",
				},
				...(run?.status === "awaiting_approval"
					? { status: "queued" as const }
					: {}),
				...(run?.currentCommand == null
					? {}
					: {
							currentCommand: {
								...(run.currentCommand as Record<string, unknown>),
								state: "done",
							},
						}),
			});
			break;
		case "run_command_queued":
			run = mergeRunState(run, {
				currentCommand: {
					seq: event.payload.seq,
					kind: event.payload.kind,
					state: "queued",
				},
			});
			break;
		case "run_started":
			run = mergeRunState(run, { status: "running" });
			break;
		case "workspace_updated":
			run = mergeRunState(run, {
				files: {
					...((run?.files as Record<string, unknown> | undefined) ?? {}),
					workspaceRef: event.payload.workspaceRef,
				},
			});
			break;
		case "run_aborted":
			run = mergeRunState(run, {
				status: "aborted",
				...(run?.currentCommand == null
					? {}
					: {
							currentCommand: {
								...(run.currentCommand as Record<string, unknown>),
								state: "done",
							},
						}),
			});
			break;
		case "run_done":
			run = mergeRunState(run, { status: "done" });
			break;
		case "run_failed":
			run = mergeRunState(run, { status: "failed" });
			break;
		default:
			break;
	}

	return {
		run,
		lastEventSeq: event.seq,
		artifacts,
		provenanceByArtifact: state.provenanceByArtifact,
		trace: [
			...state.trace,
			{
				seq: event.seq,
				kind: event.kind,
				detail: toTraceDetail(event),
			},
		],
	};
}
