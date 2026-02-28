import type {
	PiPromptInput,
	PiQueueMode,
	PiSessionPort,
} from "../pi";
import {
	isRetryablePiError,
	toActorTransientError,
} from "./errors";
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
};

function resolveDurableSessionId(
	actor: ActorStateModel,
	sessionId: string,
	sessionFile: string,
): string {
	if (actor.piSessionFile === sessionFile && actor.piSessionId) {
		return actor.piSessionId;
	}
	return sessionId;
}

function shouldUseStreamingCommand(
	kind: ActorMailboxMessageModel["kind"],
	isStreaming: boolean,
): "prompt" | "steer" | "followUp" {
	if (kind === "steer") {
		return "steer";
	}
	if (kind === "followUp") {
		return "followUp";
	}
	return !isStreaming ? "prompt" : "followUp";
}

export class PiActorBatchProcessor implements ActorBatchProcessor {
	private readonly sessions = new Map<string, SessionEntry>();

	constructor(
		private readonly deps: {
			createPiSession: CreateActorPiSession;
			buildPromptInput?:
				| ((
						actor: ActorStateModel,
						message: ActorMailboxMessageModel,
				  ) => Promise<PiPromptInput>)
				| undefined;
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
		try {
			await this.configureQueueMode(session);
			let finalState = await this.getSessionState(session, "get session state");
			let lastAssistantText = "";

			for (const message of input.messages) {
				const boundSessionId = resolveDurableSessionId(
					input.actor,
					finalState.sessionId,
					finalState.sessionFile,
				);
				effects.push(
					toSessionBoundEffect({
						message,
						sessionId: boundSessionId,
						sessionFile: finalState.sessionFile,
					}),
				);
				const command = shouldUseStreamingCommand(
					message.kind,
					finalState.isStreaming || input.actor.status === "streaming",
				);
				const promptInput = await this.buildPromptInput(input.actor, message);
				await this.sendMessage(session, command, promptInput);

				for (const event of session.drainPendingEvents()) {
					effects.push(toPiEventEffect({ message, event }));
				}

				await this.waitUntilIdle(session, message, effects);
				for (const event of session.drainPendingEvents()) {
					effects.push(toPiEventEffect({ message, event }));
				}

				finalState = await this.getSessionState(session, "get session state");
				lastAssistantText = await this.getLastAssistantText(session);
				const processedSessionId = resolveDurableSessionId(
					input.actor,
					finalState.sessionId,
					finalState.sessionFile,
				);
				effects.push(
					toMailboxProcessedEffect({
						message,
						sessionId: processedSessionId,
						sessionFile: finalState.sessionFile,
						lastAssistantText,
					}),
				);
			}

			const durableSessionId = resolveDurableSessionId(
				input.actor,
				finalState.sessionId,
				finalState.sessionFile,
			);

			return {
				actorStatus: finalState.isStreaming ? "streaming" : "idle",
				piSessionId: durableSessionId,
				piSessionFile: finalState.sessionFile,
				events: effects,
			};
		} finally {
			await this.releaseSession(input.actor.actorId);
		}
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
		let session: PiSessionPort;
		try {
			session = await this.deps.createPiSession(actor);
		} catch (error) {
			if (isRetryablePiError(error)) {
				throw toActorTransientError("ensure session", error);
			}
			throw error;
		}
		const entry = { session };
		this.sessions.set(actor.actorId, entry);
		return entry;
	}

	private async configureQueueMode(session: PiSessionPort): Promise<void> {
		try {
			await session.setQueueMode({
				followUpMode: this.deps.followUpMode ?? "one-at-a-time",
				steeringMode: this.deps.steeringMode ?? "one-at-a-time",
			});
		} catch (error) {
			if (isRetryablePiError(error)) {
				throw toActorTransientError("set queue mode", error);
			}
			throw error;
		}
	}

	private async buildPromptInput(
		actor: ActorStateModel,
		message: ActorMailboxMessageModel,
	): Promise<PiPromptInput> {
		if (this.deps.buildPromptInput) {
			return this.deps.buildPromptInput(actor, message);
		}
		return { message: message.text };
	}

	private async sendMessage(
		session: PiSessionPort,
		command: "prompt" | "steer" | "followUp",
		promptInput: PiPromptInput,
	): Promise<void> {
		try {
			if (command === "prompt") {
				await session.prompt(promptInput);
				return;
			}
			if (command === "steer") {
				await session.steer(promptInput.message);
				return;
			}
			await session.followUp(promptInput.message);
		} catch (error) {
			if (isRetryablePiError(error)) {
				throw toActorTransientError(`pi ${command}`, error);
			}
			throw error;
		}
	}

	private async waitUntilIdle(
		session: PiSessionPort,
		message: ActorMailboxMessageModel,
		effects: ActorBatchEffect[],
	): Promise<void> {
		try {
			await session.waitUntilIdle({
				onEvent: async (event) => {
					effects.push(toPiEventEffect({ message, event }));
				},
			});
		} catch (error) {
			if (isRetryablePiError(error)) {
				throw toActorTransientError("wait for idle", error);
			}
			throw error;
		}
	}

	private async getSessionState(session: PiSessionPort, label: string) {
		try {
			return await session.getState();
		} catch (error) {
			if (isRetryablePiError(error)) {
				throw toActorTransientError(label, error);
			}
			throw error;
		}
	}

	private async getLastAssistantText(session: PiSessionPort): Promise<string> {
		try {
			return await session.getLastAssistantText();
		} catch (error) {
			if (isRetryablePiError(error)) {
				throw toActorTransientError("get last assistant text", error);
			}
			throw error;
		}
	}

	private async releaseSession(actorId: string): Promise<void> {
		const entry = this.sessions.get(actorId);
		if (!entry) {
			return;
		}
		this.sessions.delete(actorId);
		await entry.session.close();
	}
}
