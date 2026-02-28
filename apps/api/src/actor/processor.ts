import type { PiQueueMode, PiSessionPort } from "../pi";
import {
	toMailboxProcessedEffect,
	toPiEventEffect,
	toSessionBoundEffect,
} from "./event";
import type {
	ActorBatchEffect,
	ActorBatchProcessor,
	ActorBatchResult,
	ActorMailboxMessageModel,
	ActorStateModel,
} from "./ports";

function toMailboxProcessedEvent(message: ActorMailboxMessageModel) {
	return {
		kind: "mailbox_processed",
		payload: {
			msgId: message.msgId,
			seq: message.seq,
			kind: message.kind,
		},
	};
}

export class NoopActorBatchProcessor implements ActorBatchProcessor {
	async ensureSession(_actor: ActorStateModel): Promise<void> {
		return;
	}

	async applyBatch(input: {
		actor: ActorStateModel;
		messages: ActorMailboxMessageModel[];
		workflowId: string;
	}): Promise<ActorBatchResult> {
		return {
			actorStatus: input.actor.status,
			events: input.messages.map(toMailboxProcessedEvent),
		};
	}
}

export type CreateActorPiSession = (
	actor: ActorStateModel,
) => Promise<PiSessionPort>;

type SessionEntry = {
	session: PiSessionPort;
	queueConfigured: boolean;
};

function shouldUseStreamingCommand(
	kind: ActorMailboxMessageModel["kind"],
	isStreaming: boolean,
): "prompt" | "steer" | "followUp" {
	if (!isStreaming) {
		return "prompt";
	}
	return kind === "steer" ? "steer" : "followUp";
}

export class PiActorBatchProcessor implements ActorBatchProcessor {
	private readonly sessions = new Map<string, SessionEntry>();

	constructor(
		private readonly deps: {
			createPiSession: CreateActorPiSession;
			followUpMode?: PiQueueMode | undefined;
			steeringMode?: PiQueueMode | undefined;
		},
	) {}

	async ensureSession(actor: ActorStateModel): Promise<void> {
		await this.getOrCreateSession(actor);
	}

	async applyBatch(input: {
		actor: ActorStateModel;
		messages: ActorMailboxMessageModel[];
		workflowId: string;
	}): Promise<ActorBatchResult> {
		const effects: ActorBatchEffect[] = [];
		const entry = await this.getOrCreateSession(input.actor);
		const session = entry.session;
		let finalState = await session.getState();
		let lastAssistantText = "";

		for (const message of input.messages) {
			const command = shouldUseStreamingCommand(
				message.kind,
				finalState.isStreaming || input.actor.status === "streaming",
			);
			if (!entry.queueConfigured) {
				await session.setQueueMode({
					followUpMode: this.deps.followUpMode ?? "one-at-a-time",
					steeringMode: this.deps.steeringMode ?? "one-at-a-time",
				});
				entry.queueConfigured = true;
				effects.push(
					toSessionBoundEffect({
						message,
						sessionId: finalState.sessionId,
						sessionFile: finalState.sessionFile,
					}),
				);
			}

			if (command === "prompt") {
				await session.prompt({ message: message.text });
			} else if (command === "steer") {
				await session.steer(message.text);
			} else {
				await session.followUp(message.text);
			}

			for (const event of session.drainPendingEvents()) {
				effects.push(toPiEventEffect({ message, event }));
			}

			await session.waitUntilIdle({
				onEvent: async (event) => {
					effects.push(toPiEventEffect({ message, event }));
				},
			});
			for (const event of session.drainPendingEvents()) {
				effects.push(toPiEventEffect({ message, event }));
			}

			finalState = await session.getState();
			lastAssistantText = await session.getLastAssistantText();
			effects.push(
				toMailboxProcessedEffect({
					message,
					sessionId: finalState.sessionId,
					sessionFile: finalState.sessionFile,
					lastAssistantText,
				}),
			);
		}

		return {
			actorStatus: finalState.isStreaming ? "streaming" : "idle",
			piSessionId: finalState.sessionId,
			piSessionFile: finalState.sessionFile,
			events: effects,
		};
	}

	async closeAll(): Promise<void> {
		const sessions = [...this.sessions.values()];
		this.sessions.clear();
		for (const entry of sessions) {
			await entry.session.close();
		}
	}

	private async getOrCreateSession(
		actor: ActorStateModel,
	): Promise<SessionEntry> {
		const existing = this.sessions.get(actor.actorId);
		if (existing) {
			return existing;
		}
		const session = await this.deps.createPiSession(actor);
		const entry = {
			session,
			queueConfigured: false,
		};
		this.sessions.set(actor.actorId, entry);
		return entry;
	}
}
