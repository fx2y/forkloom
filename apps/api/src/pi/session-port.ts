import {
	PiRpcClient,
	type PiRpcEvent,
	type PiRpcPayload,
	type PiRpcResponse,
	type SpawnPiRpcInput,
	spawnPiRpcProcess,
} from "./rpc-client";

export type PiStreamingBehavior = "steer" | "followUp";
export type PiQueueMode = "one-at-a-time" | "all";

export type PiImageInput = {
	type: "image";
	data: string;
	mimeType: string;
};

export type PiPromptInput = {
	message: string;
	images?: PiImageInput[] | undefined;
	streamingBehavior?: PiStreamingBehavior | undefined;
};

export type PiSessionState = {
	sessionFile: string;
	sessionId: string;
	isStreaming: boolean;
	pending: number;
};

export type PiSessionStats = Record<string, unknown>;

type PiRpcClientLike = {
	send(payload: PiRpcPayload): void;
	waitResponse(id: string): Promise<PiRpcResponse>;
	drainEvents(): PiRpcEvent[];
	close(): Promise<void>;
};

export interface PiSessionPort {
	prompt(input: PiPromptInput): Promise<void>;
	steer(message: string): Promise<void>;
	followUp(message: string): Promise<void>;
	setQueueMode(input: {
		followUpMode?: PiQueueMode | undefined;
		steeringMode?: PiQueueMode | undefined;
	}): Promise<void>;
	abort(): Promise<void>;
	getState(): Promise<PiSessionState>;
	getLastAssistantText(): Promise<string>;
	getSessionStats(): Promise<PiSessionStats>;
	drainPendingEvents(): PiRpcEvent[];
	waitUntilIdle(options?: {
		pollMs?: number | undefined;
		timeoutMs?: number | undefined;
		onEvent?: ((event: PiRpcEvent) => Promise<void> | void) | undefined;
	}): Promise<void>;
	close(): Promise<void>;
}

export type CreatePiSessionInput = SpawnPiRpcInput & {
	responseTimeoutMs?: number | undefined;
};

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`${label} must be a non-empty string`);
	}
	return value;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return fallback;
	}
	return value;
}

async function assertSuccess(
	command: string,
	response: PiRpcResponse,
): Promise<Record<string, unknown>> {
	if (response.success === false) {
		throw new Error(`${command} failed: ${response.error ?? "unknown error"}`);
	}
	return asRecord(response.data ?? {}, `${command}.data`);
}

export class RpcPiSessionPort implements PiSessionPort {
	private readonly rpc: PiRpcClientLike;
	private nextCommandId: number;

	constructor(rpcClient: PiRpcClientLike) {
		this.rpc = rpcClient;
		this.nextCommandId = 1;
	}

	private nextId(prefix: string): string {
		const id = `${prefix}-${this.nextCommandId}`;
		this.nextCommandId += 1;
		return id;
	}

	private async rpcCommand(
		command: string,
		payload: Omit<PiRpcPayload, "id" | "type"> = {},
	): Promise<Record<string, unknown>> {
		const id = this.nextId(command);
		this.rpc.send({ ...payload, id, type: command });
		const response = await this.rpc.waitResponse(id);
		return assertSuccess(command, response);
	}

	async prompt(input: PiPromptInput): Promise<void> {
		const state = await this.getState();
		if (state.isStreaming && !input.streamingBehavior) {
			throw new Error(
				"prompt during active stream requires streamingBehavior (steer|followUp)",
			);
		}
		await this.rpcCommand("prompt", {
			message: input.message,
			images: input.images,
			streamingBehavior: input.streamingBehavior,
		});
	}

	async steer(message: string): Promise<void> {
		await this.rpcCommand("steer", { message });
	}

	async followUp(message: string): Promise<void> {
		await this.rpcCommand("follow_up", { message });
	}

	async setQueueMode(input: {
		followUpMode?: PiQueueMode | undefined;
		steeringMode?: PiQueueMode | undefined;
	}): Promise<void> {
		if (input.followUpMode) {
			await this.rpcCommand("set_follow_up_mode", {
				mode: input.followUpMode,
			});
		}
		if (input.steeringMode) {
			await this.rpcCommand("set_steering_mode", {
				mode: input.steeringMode,
			});
		}
	}

	async abort(): Promise<void> {
		await this.rpcCommand("abort");
	}

	async getState(): Promise<PiSessionState> {
		const data = await this.rpcCommand("get_state");
		return {
			sessionFile: asString(data.sessionFile, "get_state.sessionFile"),
			sessionId: asString(data.sessionId, "get_state.sessionId"),
			isStreaming: asBoolean(data.isStreaming, false),
			pending: asNumber(data.pending, 0),
		};
	}

	async getLastAssistantText(): Promise<string> {
		const data = await this.rpcCommand("get_last_assistant_text");
		return typeof data.text === "string" ? data.text : "";
	}

	async getSessionStats(): Promise<PiSessionStats> {
		return this.rpcCommand("get_session_stats");
	}

	drainPendingEvents(): PiRpcEvent[] {
		return this.rpc.drainEvents();
	}

	async waitUntilIdle(options?: {
		pollMs?: number | undefined;
		timeoutMs?: number | undefined;
		onEvent?: ((event: PiRpcEvent) => Promise<void> | void) | undefined;
	}): Promise<void> {
		const pollMs = options?.pollMs ?? 50;
		const timeoutMs = options?.timeoutMs ?? 30_000;
		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			const events = this.rpc.drainEvents();
			for (const event of events) {
				if (options?.onEvent) {
					await options.onEvent(event);
				}
			}

			const state = await this.getState();
			if (!state.isStreaming && state.pending === 0) {
				return;
			}

			await new Promise((resolveSleep) => {
				setTimeout(resolveSleep, pollMs);
			});
		}

		throw new Error("timed out waiting for pi stream idle state");
	}

	async close(): Promise<void> {
		await this.rpc.close();
	}
}

export function createPiSessionPort(
	input: CreatePiSessionInput,
): PiSessionPort {
	const process = spawnPiRpcProcess(input);
	const rpc = new PiRpcClient({
		process,
		responseTimeoutMs: input.responseTimeoutMs,
	});
	return new RpcPiSessionPort(rpc);
}
