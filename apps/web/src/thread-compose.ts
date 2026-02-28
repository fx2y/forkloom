import type { ActorSpec, ActorState, MailboxKind } from "@forkloom/contracts";
import type { ActorThreadView } from "./state/actor-reducer";

const MENTION_RE = /^@([A-Za-z0-9:_-]+)\s+([\s\S]+)$/;

export type ComposeTarget = {
	actorId: string;
	actorName: string;
	text: string;
	mentioned: boolean;
};

type ActorIdentity = Pick<ActorState, "actorId" | "name">;

function normalizeHandle(value: string): string {
	return value.trim().toLowerCase();
}

export function normalizeActorId(value: string): string {
	const sanitized = value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9:_-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-+|-+$/g, "");
	const base = sanitized.length > 0 ? sanitized : "thread";
	const safe = /^[a-z0-9]/.test(base) ? base : `thread-${base}`;
	return safe.slice(0, 64);
}

function findKnownActor(
	actors: ActorIdentity[],
	handle: string,
): ActorIdentity | undefined {
	const normalized = normalizeHandle(handle);
	return actors.find(
		(actor) =>
			normalizeHandle(actor.actorId) === normalized ||
			normalizeHandle(actor.name) === normalized,
	);
}

export function resolveComposeTarget(input: {
	text: string;
	selectedActorId: string | null;
	threads: ActorThreadView[];
}): ComposeTarget {
	const trimmed = input.text.trim();
	if (trimmed.length === 0) {
		throw new Error("message text is required");
	}

	const actors = input.threads.map(({ actor }) => actor);
	const mentioned = trimmed.match(MENTION_RE);
	if (mentioned) {
		const handle = mentioned[1];
		const body = mentioned[2];
		if (!handle || !body) {
			throw new Error("message text is required");
		}
		const text = body.trim();
		if (text.length === 0) {
			throw new Error("message text is required");
		}
		const known = findKnownActor(actors, handle);
		return {
			actorId: known?.actorId ?? normalizeActorId(handle),
			actorName: known?.name ?? handle,
			text,
			mentioned: true,
		};
	}

	if (!input.selectedActorId) {
		throw new Error("select a thread or prefix the message with @actor");
	}
	const selected = actors.find(
		(actor) => actor.actorId === input.selectedActorId,
	);
	if (!selected) {
		throw new Error("selected thread is unavailable");
	}
	return {
		actorId: selected.actorId,
		actorName: selected.name,
		text: trimmed,
		mentioned: false,
	};
}

export function deriveMailboxKind(input: {
	interrupt: boolean;
	thread: ActorThreadView | null;
}): MailboxKind {
	if (input.interrupt) {
		return "steer";
	}
	return input.thread?.pendingMailboxSeqs.length ? "followUp" : "prompt";
}

export function toActorSpec(target: ComposeTarget): ActorSpec {
	return {
		actorId: target.actorId,
		name: target.actorName,
	};
}
