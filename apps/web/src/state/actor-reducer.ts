import type { ActorEvent, ActorState, ActorStatus } from "@forkloom/contracts";

export type ThreadArtifactView = {
	key: string;
	label: string;
	kind: string;
	href?: string | undefined;
};

export type ThreadTraceView = {
	seq: number;
	kind: ActorEvent["kind"];
	detail: string;
};

export type ActorThreadView = {
	actor: ActorState;
	lastEventSeq: number;
	lastActivityAt: string;
	events: ActorEvent[];
	trace: ThreadTraceView[];
	artifacts: ThreadArtifactView[];
	latestAssistantText: string;
	latestError: string | null;
	pendingMailboxSeqs: number[];
};

export type InboxViewState = {
	selectedActorId: string | null;
	threads: Record<string, ActorThreadView>;
};

const EMPTY_ISO = "1970-01-01T00:00:00.000Z";

function createThread(actor: ActorState): ActorThreadView {
	return {
		actor,
		lastEventSeq: 0,
		lastActivityAt: actor.updatedAt,
		events: [],
		trace: [],
		artifacts: [],
		latestAssistantText: "",
		latestError: null,
		pendingMailboxSeqs: [],
	};
}

function appendUniqueNumber(values: number[], value: number): number[] {
	return values.includes(value) ? values : [...values, value];
}

function removeNumber(values: number[], value: number): number[] {
	return values.filter((entry) => entry !== value);
}

function basename(value: string): string {
	const normalized = value.split(/[\\/]/);
	return normalized[normalized.length - 1] ?? value;
}

function appendArtifact(
	artifacts: ThreadArtifactView[],
	artifact: ThreadArtifactView,
): ThreadArtifactView[] {
	return artifacts.some((entry) => entry.key === artifact.key)
		? artifacts
		: [...artifacts, artifact];
}

function appendShaArtifacts(
	artifacts: ThreadArtifactView[],
	value: unknown,
): ThreadArtifactView[] {
	if (typeof value === "string" && /^[a-f0-9]{64}$/.test(value)) {
		return appendArtifact(artifacts, {
			key: `sha256:${value}`,
			label: value.slice(0, 12),
			kind: "artifact",
			href: `/artifacts/${value}`,
		});
	}
	if (Array.isArray(value)) {
		return value.reduce(appendShaArtifacts, artifacts);
	}
	if (typeof value === "object" && value !== null) {
		return Object.values(value).reduce(appendShaArtifacts, artifacts);
	}
	return artifacts;
}

function appendPayloadArtifacts(
	artifacts: ThreadArtifactView[],
	payload: Record<string, unknown>,
): ThreadArtifactView[] {
	let next = appendShaArtifacts(artifacts, payload);
	if (
		typeof payload.sessionFile === "string" &&
		payload.sessionFile.length > 0
	) {
		next = appendArtifact(next, {
			key: `session:${payload.sessionFile}`,
			label: basename(payload.sessionFile),
			kind: "session",
		});
	}
	return next;
}

function toTraceDetail(event: ActorEvent): string {
	switch (event.kind) {
		case "mailbox_queued":
			return `${String(event.payload.kind ?? "message")} queued`;
		case "session_bound":
			return `session ${String(event.payload.sessionId ?? "bound")}`;
		case "mailbox_processed":
			return `${String(event.payload.kind ?? "message")} completed`;
		case "mailbox_failed":
			return String(event.payload.error ?? "mailbox failed");
		case "pi_event": {
			const payloadEvent = event.payload.event;
			if (typeof payloadEvent === "object" && payloadEvent !== null) {
				const record = payloadEvent as Record<string, unknown>;
				const name =
					typeof record.kind === "string"
						? record.kind
						: typeof record.type === "string"
							? record.type
							: typeof record.name === "string"
								? record.name
								: "pi_event";
				return name;
			}
			return "pi_event";
		}
	}
}

export const initialInboxViewState: InboxViewState = {
	selectedActorId: null,
	threads: {},
};

export function selectActor(
	state: InboxViewState,
	actorId: string | null,
): InboxViewState {
	if (actorId != null && !state.threads[actorId]) {
		return state;
	}
	return {
		...state,
		selectedActorId: actorId,
	};
}

export function upsertActorState(
	state: InboxViewState,
	actor: ActorState,
): InboxViewState {
	const existing = state.threads[actor.actorId];
	const thread = existing ?? createThread(actor);
	return {
		...state,
		selectedActorId: state.selectedActorId ?? actor.actorId,
		threads: {
			...state.threads,
			[actor.actorId]: {
				...thread,
				actor,
				lastActivityAt:
					thread.events.length === 0 ? actor.updatedAt : thread.lastActivityAt,
			},
		},
	};
}

export function reduceActorEvent(
	state: InboxViewState,
	event: ActorEvent,
): InboxViewState {
	const existing = state.threads[event.actorId];
	if (!existing || event.seq <= existing.lastEventSeq) {
		return state;
	}

	let nextThread: ActorThreadView = {
		...existing,
		lastEventSeq: event.seq,
		lastActivityAt: event.t,
		events: [...existing.events, event],
		trace: [
			...existing.trace,
			{
				seq: event.seq,
				kind: event.kind,
				detail: toTraceDetail(event),
			},
		],
		artifacts: appendPayloadArtifacts(existing.artifacts, event.payload),
	};

	const mailboxSeq =
		typeof event.payload.seq === "number" ? event.payload.seq : null;

	switch (event.kind) {
		case "mailbox_queued":
			if (mailboxSeq != null) {
				nextThread = {
					...nextThread,
					pendingMailboxSeqs: appendUniqueNumber(
						nextThread.pendingMailboxSeqs,
						mailboxSeq,
					),
				};
			}
			break;
		case "mailbox_processed":
			nextThread = {
				...nextThread,
				latestAssistantText:
					typeof event.payload.lastAssistantText === "string"
						? event.payload.lastAssistantText
						: nextThread.latestAssistantText,
				latestError: null,
				pendingMailboxSeqs:
					mailboxSeq == null
						? nextThread.pendingMailboxSeqs
						: removeNumber(nextThread.pendingMailboxSeqs, mailboxSeq),
			};
			break;
		case "mailbox_failed":
			nextThread = {
				...nextThread,
				latestError:
					typeof event.payload.error === "string"
						? event.payload.error
						: "mailbox failed",
				pendingMailboxSeqs:
					mailboxSeq == null
						? nextThread.pendingMailboxSeqs
						: removeNumber(nextThread.pendingMailboxSeqs, mailboxSeq),
			};
			break;
		default:
			break;
	}

	return {
		...state,
		threads: {
			...state.threads,
			[event.actorId]: nextThread,
		},
	};
}

export function replayActorEvents(
	actor: ActorState,
	events: ActorEvent[],
): ActorThreadView {
	const finalState = events.reduce(
		(state, event) => reduceActorEvent(state, event),
		upsertActorState(initialInboxViewState, actor),
	);
	const thread = finalState.threads[actor.actorId];
	if (!thread) {
		throw new Error(`missing replayed thread ${actor.actorId}`);
	}
	return thread;
}

export function listInboxThreads(state: InboxViewState): ActorThreadView[] {
	return Object.values(state.threads).sort((left, right) => {
		const timeCompare = right.lastActivityAt.localeCompare(left.lastActivityAt);
		if (timeCompare !== 0) {
			return timeCompare;
		}
		return left.actor.name.localeCompare(right.actor.name);
	});
}

export function getSelectedThread(
	state: InboxViewState,
): ActorThreadView | null {
	return state.selectedActorId
		? (state.threads[state.selectedActorId] ?? null)
		: null;
}

export function deriveThreadPresence(thread: ActorThreadView): ActorStatus {
	if (thread.actor.status === "dead" || thread.actor.status === "blocked") {
		return thread.actor.status;
	}
	return thread.pendingMailboxSeqs.length > 0
		? "streaming"
		: thread.actor.status;
}

export function summarizeThread(thread: ActorThreadView): {
	preview: string;
	presence: ActorStatus;
	activityLabel: string;
} {
	const preview =
		thread.latestAssistantText ||
		thread.latestError ||
		(thread.events.length > 0
			? thread.trace[thread.trace.length - 1]?.detail
			: "") ||
		"No assistant output yet.";
	return {
		preview,
		presence: deriveThreadPresence(thread),
		activityLabel:
			thread.lastActivityAt === EMPTY_ISO
				? thread.actor.updatedAt
				: thread.lastActivityAt,
	};
}
