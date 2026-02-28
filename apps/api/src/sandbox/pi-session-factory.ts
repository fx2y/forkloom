import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	createManagedPiSessionFactory,
	type MockPiProviderManager,
	type ManagedPiSessionOverrides,
	type PiPromptInput,
	type PiQueueMode,
	type PiRpcPayload,
	type PiSessionPort,
	type PiSessionState,
	type PiSessionStats,
	type CreatePiSessionInput,
	PiRpcClient,
} from "../pi";
import { DockerCli } from "./docker-cli";

export type SandboxPiSessionInput = {
	containerName: string;
	cwd: string;
	homeHostDir: string;
	homePath: string;
	provider: string;
	model: string;
	sessionPath?: string | undefined;
	strictReal?: boolean | undefined;
	piCommand?: string[] | undefined;
};

function asRecord(
	value: unknown,
	label: string,
): Record<string, unknown> {
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
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function ensureLocalSessionFile(path: string, sessionId: string): void {
	if (existsSync(path)) {
		return;
	}
	mkdirSync(dirname(path), { recursive: true });
	try {
		writeFileSync(
			path,
			`${JSON.stringify({
				type: "session",
				version: 3,
				id: sessionId,
				timestamp: new Date().toISOString(),
				cwd: process.cwd(),
			})}\n`,
			{ encoding: "utf8", flag: "wx" },
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
			throw error;
		}
	}
}

class SandboxRpcSessionPort implements PiSessionPort {
	private nextCommandId = 1;

	constructor(
		private readonly rpc: PiRpcClient,
		private readonly homePath: string,
		private readonly homeHostDir: string,
	) {}

	private remapPath(path: string): string {
		return path.startsWith(this.homePath)
			? join(this.homeHostDir, path.slice(this.homePath.length))
			: path;
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
		if (response.success === false) {
			throw new Error(`${command} failed: ${response.error ?? "unknown error"}`);
		}
		return asRecord(response.data ?? {}, `${command}.data`);
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

	steer(message: string): Promise<void> {
		return this.rpcCommand("steer", { message }).then(() => undefined);
	}

	followUp(message: string): Promise<void> {
		return this.rpcCommand("follow_up", { message }).then(() => undefined);
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

	abort(): Promise<void> {
		return this.rpcCommand("abort").then(() => undefined);
	}

	async getState(): Promise<PiSessionState> {
		const data = await this.rpcCommand("get_state");
		const sessionFile = this.remapPath(
			asString(data.sessionFile, "get_state.sessionFile"),
		);
		const sessionId = asString(data.sessionId, "get_state.sessionId");
		ensureLocalSessionFile(sessionFile, sessionId);
		return {
			sessionFile,
			sessionId,
			isStreaming: asBoolean(data.isStreaming, false),
			pending: asNumber(data.pending, 0),
		};
	}

	getLastAssistantText(): Promise<string> {
		return this.rpcCommand("get_last_assistant_text").then((data) =>
			typeof data.text === "string" ? data.text : "",
		);
	}

	getSessionStats(): Promise<PiSessionStats> {
		return this.rpcCommand("get_session_stats");
	}

	drainPendingEvents(): Record<string, unknown>[] {
		return this.rpc.drainEvents();
	}

	async waitUntilIdle(
		options?: Parameters<PiSessionPort["waitUntilIdle"]>[0],
	): Promise<void> {
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
			await new Promise((resolveSleep) => setTimeout(resolveSleep, pollMs));
		}
		throw new Error("timed out waiting for pi stream idle state");
	}

	close(): Promise<void> {
		return this.rpc.close();
	}
}

function copyPiAgentFile(
	sourceHome: string,
	targetHome: string,
	fileName: string,
): void {
	const source = join(sourceHome, ".pi", "agent", fileName);
	const target = join(targetHome, ".pi", "agent", fileName);
	try {
		copyFileSync(source, target);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
}

function hydrateSandboxPiHome(
	sourceHome: string,
	targetHome: string,
): void {
	mkdirSync(join(targetHome, ".pi", "agent", "sessions"), {
		recursive: true,
	});
	copyPiAgentFile(sourceHome, targetHome, "auth.json");
	copyPiAgentFile(sourceHome, targetHome, "settings.json");
	copyPiAgentFile(sourceHome, targetHome, "models.json");
}

function buildSandboxPiRpcArgs(input: {
	containerName: string;
	cwd: string;
	homePath: string;
	provider: string;
	model: string;
	sessionPath?: string | undefined;
	piCommand?: string[] | undefined;
}): string[] {
	const command = input.piCommand ?? ["pi", "--mode", "rpc"];
	const args = [
		"exec",
		"-i",
		"-w",
		input.cwd,
		"-e",
		`HOME=${input.homePath}`,
		input.containerName,
		...command,
		"--provider",
		input.provider,
		"--model",
		input.model,
	];
	if (input.sessionPath) {
		args.push("--session", input.sessionPath);
	}
	return args;
}

export function createSandboxPiSessionFactory(
	input: SandboxPiSessionInput,
	deps: {
		dockerCli?: DockerCli | undefined;
		sourceHome?: string | undefined;
		mockProviderManager?: MockPiProviderManager | undefined;
	} = {},
): (overrides?: ManagedPiSessionOverrides) => Promise<PiSessionPort> {
	const dockerCli = deps.dockerCli ?? new DockerCli();
	const sourceHome = deps.sourceHome ?? (process.env.HOME ?? "");

	return createManagedPiSessionFactory(
		{
			provider: input.provider,
			model: input.model,
			cwd: input.cwd,
			sessionPath: input.sessionPath,
			strictReal: input.strictReal,
		},
		{
			mockProviderManager: deps.mockProviderManager,
			createSessionPort: (sessionInput: CreatePiSessionInput) => {
				const source = sessionInput.homeOverride ?? sourceHome;
				hydrateSandboxPiHome(source, input.homeHostDir);
				const child = dockerCli.spawn(
					buildSandboxPiRpcArgs({
						containerName: input.containerName,
						cwd: sessionInput.cwd ?? input.cwd,
						homePath: input.homePath,
						provider: sessionInput.provider,
						model: sessionInput.model,
						sessionPath: sessionInput.sessionPath,
						piCommand: input.piCommand,
					}),
				);
				const client = new PiRpcClient({
					process: child,
					responseTimeoutMs: sessionInput.responseTimeoutMs,
				});
				return new SandboxRpcSessionPort(
					client,
					input.homePath,
					input.homeHostDir,
				);
			},
			prepareRealHome: async () => sourceHome,
		},
	);
}

export { buildSandboxPiRpcArgs, hydrateSandboxPiHome };
