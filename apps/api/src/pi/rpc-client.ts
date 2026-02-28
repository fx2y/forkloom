import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { resolve } from "node:path";
import readline from "node:readline";

export type PiRpcPayload = {
	type: string;
	id?: string | undefined;
	[key: string]: unknown;
};

export type PiRpcResponse = {
	type: "response";
	id?: string | undefined;
	command?: string | undefined;
	success?: boolean | undefined;
	error?: string | undefined;
	data?: Record<string, unknown> | undefined;
};

export type PiRpcEvent = Record<string, unknown>;

export type PiRpcProcess = {
	stdin: NodeJS.WritableStream;
	stdout: NodeJS.ReadableStream;
	stderr: NodeJS.ReadableStream;
	kill(signal?: NodeJS.Signals | number): boolean;
	once(
		event: "exit",
		listener: (code: number | null, signal: NodeJS.Signals | null) => void,
	): void;
};

export type PiRpcClientDeps = {
	process: PiRpcProcess;
	responseTimeoutMs?: number | undefined;
};

export type SpawnPiRpcInput = {
	provider: string;
	model: string;
	cwd?: string | undefined;
	homeOverride?: string | undefined;
	sessionPath?: string | undefined;
	extraEnv?: NodeJS.ProcessEnv | undefined;
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolveSleep) => {
		setTimeout(resolveSleep, ms);
	});
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isRpcResponse(value: unknown): value is PiRpcResponse {
	return (
		isRecord(value) &&
		value.type === "response" &&
		(value.id === undefined || typeof value.id === "string")
	);
}

export function spawnPiRpcProcess(
	input: SpawnPiRpcInput,
): ChildProcessWithoutNullStreams {
	const piBin = resolve("node_modules", ".bin", "pi");
	const args = [
		"--mode",
		"rpc",
		"--provider",
		input.provider,
		"--model",
		input.model,
	];
	if (input.sessionPath) {
		args.push("--session", input.sessionPath);
	}
	return spawn(
		piBin,
		args,
		{
			cwd: input.cwd ?? process.cwd(),
			env: {
				...process.env,
				...(input.extraEnv ?? {}),
				...(input.homeOverride ? { HOME: input.homeOverride } : {}),
			},
			stdio: ["pipe", "pipe", "pipe"],
		},
	);
}

export class PiRpcClient {
	private readonly process: PiRpcProcess;
	private readonly responseTimeoutMs: number;
	private readonly responseById: Record<string, PiRpcResponse>;
	private readonly eventQueue: PiRpcEvent[];
	private readonly lines: readline.Interface;

	constructor(deps: PiRpcClientDeps) {
		this.process = deps.process;
		this.responseTimeoutMs = deps.responseTimeoutMs ?? 30_000;
		this.responseById = Object.create(null) as Record<string, PiRpcResponse>;
		this.eventQueue = [];
		this.lines = readline.createInterface({ input: this.process.stdout });
		this.lines.on("line", (line) => {
			const trimmed = line.trim();
			if (!trimmed.startsWith("{")) {
				return;
			}
			const parsed = JSON.parse(trimmed) as unknown;
			if (isRpcResponse(parsed) && typeof parsed.id === "string") {
				this.responseById[parsed.id] = parsed;
				return;
			}
			if (isRecord(parsed)) {
				this.eventQueue.push(parsed);
			}
		});
	}

	send(payload: PiRpcPayload): void {
		this.process.stdin.write(`${JSON.stringify(payload)}\n`);
	}

	async waitResponse(id: string): Promise<PiRpcResponse> {
		const deadline = Date.now() + this.responseTimeoutMs;
		while (Date.now() < deadline) {
			const found = this.responseById[id];
			if (found) {
				delete this.responseById[id];
				return found;
			}
			await sleep(25);
		}
		throw new Error(`timeout waiting pi response id=${id}`);
	}

	drainEvents(): PiRpcEvent[] {
		if (this.eventQueue.length === 0) {
			return [];
		}
		const copy = [...this.eventQueue];
		this.eventQueue.length = 0;
		return copy;
	}

	async close(): Promise<void> {
		this.lines.close();
		await new Promise<void>((resolveExit) => {
			this.process.once("exit", () => resolveExit());
			const killed = this.process.kill("SIGTERM");
			if (!killed) {
				resolveExit();
			}
		});
	}
}
