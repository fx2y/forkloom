import type { RunEvent } from "@forkloom/contracts";

export type RunArtifactView = {
	sha256: string;
	kind: string;
	href: string;
};

export type RunViewState = {
	runId: string | null;
	status: "idle" | "running" | "done" | "failed";
	lastSeq: number;
	resultText: string;
	error: string | null;
	artifacts: RunArtifactView[];
	trace: RunEvent[];
};

export const initialRunViewState: RunViewState = {
	runId: null,
	status: "idle",
	lastSeq: 0,
	resultText: "",
	error: null,
	artifacts: [],
	trace: [],
};

function appendArtifact(
	artifacts: RunArtifactView[],
	artifact: RunArtifactView,
): RunArtifactView[] {
	if (artifacts.some((entry) => entry.sha256 === artifact.sha256)) {
		return artifacts;
	}
	return [...artifacts, artifact];
}

function artifactFromPayload(
	payload: Record<string, unknown>,
): RunArtifactView | null {
	if (typeof payload.sha256 !== "string" || typeof payload.kind !== "string") {
		return null;
	}
	return {
		sha256: payload.sha256,
		kind: payload.kind,
		href: `/artifacts/${payload.sha256}`,
	};
}

export function reduceRunEvent(
	state: RunViewState,
	event: RunEvent,
): RunViewState {
	if (event.seq <= state.lastSeq) {
		return state;
	}

	let next: RunViewState = {
		...state,
		runId: event.runId,
		lastSeq: event.seq,
		trace: [...state.trace, event],
	};

	switch (event.kind) {
		case "run_started":
			next = { ...next, status: "running", error: null };
			break;
		case "artifact_written": {
			const artifact = artifactFromPayload(event.payload);
			if (artifact) {
				next = {
					...next,
					artifacts: appendArtifact(next.artifacts, artifact),
				};
			}
			break;
		}
		case "run_done": {
			const artifacts = Array.isArray(event.payload.artifacts)
				? event.payload.artifacts
						.filter(
							(item): item is string =>
								typeof item === "string" && item.length > 0,
						)
						.reduce(
							(list, sha256) =>
								appendArtifact(list, {
									sha256,
									kind: "output",
									href: `/artifacts/${sha256}`,
								}),
							next.artifacts,
						)
				: next.artifacts;
			next = {
				...next,
				status: "done",
				resultText:
					typeof event.payload.text === "string" ? event.payload.text : "",
				artifacts,
			};
			break;
		}
		case "run_failed":
			next = {
				...next,
				status: "failed",
				error:
					typeof event.payload.error === "string"
						? event.payload.error
						: "run failed",
			};
			break;
		default:
			break;
	}

	return next;
}

export function replayRunEvents(events: RunEvent[]): RunViewState {
	return events.reduce(reduceRunEvent, initialRunViewState);
}
