import { copyFile, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockPiProviderManager } from "./mock-provider";
import {
	type CreatePiSessionInput,
	type PiImageInput,
	type PiPromptInput,
	type PiQueueMode,
	type PiSessionPort,
	type PiSessionState,
	type PiSessionStats,
	type PiStreamingBehavior,
	createPiSessionPort,
} from "./session-port";

export type ManagedPiSessionOverrides = Partial<
	Pick<
		CreatePiSessionInput,
		"cwd" | "extraEnv" | "homeOverride" | "model" | "sessionPath"
	>
> & {
	bootstrapTimeoutMs?: number | undefined;
	mockBootstrapTimeoutMs?: number | undefined;
};

type ManagedPiSessionInput = CreatePiSessionInput & {
	strictReal?: boolean | undefined;
	bootstrapTimeoutMs?: number | undefined;
	mockBootstrapTimeoutMs?: number | undefined;
};

type SessionFactoryDeps = {
	createSessionPort?:
		| ((input: CreatePiSessionInput) => PiSessionPort)
		| undefined;
	mockProviderManager?: MockPiProviderManager | undefined;
	prepareRealHome?: (() => Promise<string>) | undefined;
};

function toSessionScopeDir(cwd = process.cwd()): string {
	return `--${cwd.replace(/[\\/]+/g, "-").replace(/^-+|-+$/g, "")}--`;
}

async function copyPiStateFile(
	sourceAgentDir: string,
	targetAgentDir: string,
	fileName: string,
): Promise<void> {
	try {
		await copyFile(
			join(sourceAgentDir, fileName),
			join(targetAgentDir, fileName),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
			throw error;
		}
	}
}

export async function prepareWritablePiHome(
	sourceHome = process.env.HOME ?? "",
): Promise<string> {
	const sourceAgentDir = join(sourceHome, ".pi", "agent");
	const realHomeDir = await mkdtemp(join(tmpdir(), "forkloom-pi-real-home-"));
	const targetAgentDir = join(realHomeDir, ".pi", "agent");
	await mkdir(join(targetAgentDir, "sessions"), { recursive: true });
	await mkdir(join(targetAgentDir, "sessions", toSessionScopeDir()), {
		recursive: true,
	});
	await copyPiStateFile(sourceAgentDir, targetAgentDir, "auth.json");
	await copyPiStateFile(sourceAgentDir, targetAgentDir, "settings.json");
	await copyPiStateFile(sourceAgentDir, targetAgentDir, "models.json");
	return realHomeDir;
}

class ManagedPiSessionPort implements PiSessionPort {
	private closed = false;

	constructor(
		private readonly inner: PiSessionPort,
		private readonly cleanup: () => Promise<void>,
	) {}

	prompt(input: PiPromptInput): Promise<void> {
		return this.inner.prompt(input);
	}

	steer(message: string): Promise<void> {
		return this.inner.steer(message);
	}

	followUp(message: string): Promise<void> {
		return this.inner.followUp(message);
	}

	setQueueMode(input: {
		followUpMode?: PiQueueMode | undefined;
		steeringMode?: PiQueueMode | undefined;
	}): Promise<void> {
		return this.inner.setQueueMode(input);
	}

	abort(): Promise<void> {
		return this.inner.abort();
	}

	getState(): Promise<PiSessionState> {
		return this.inner.getState();
	}

	getLastAssistantText(): Promise<string> {
		return this.inner.getLastAssistantText();
	}

	getSessionStats(): Promise<PiSessionStats> {
		return this.inner.getSessionStats();
	}

	drainPendingEvents(): Record<string, unknown>[] {
		return this.inner.drainPendingEvents();
	}

	waitUntilIdle(options?: {
		pollMs?: number | undefined;
		timeoutMs?: number | undefined;
		onEvent?:
			| ((event: Record<string, unknown>) => Promise<void> | void)
			| undefined;
	}): Promise<void> {
		return this.inner.waitUntilIdle(options);
	}

	async close(): Promise<void> {
		if (this.closed) {
			return;
		}
		this.closed = true;
		try {
			await this.inner.close();
		} finally {
			await this.cleanup();
		}
	}
}

async function awaitWithTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	label: string,
): Promise<T> {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
		}),
	]);
}

async function safeClose(session: PiSessionPort | null): Promise<void> {
	if (!session) {
		return;
	}
	try {
		await session.close();
	} catch {
		// Ignore cleanup failures while switching providers.
	}
}

export function createManagedPiSessionFactory(
	input: ManagedPiSessionInput,
	deps: SessionFactoryDeps = {},
): (overrides?: ManagedPiSessionOverrides) => Promise<PiSessionPort> {
	const createSessionPort = deps.createSessionPort ?? createPiSessionPort;
	const mockProviderManager =
		deps.mockProviderManager ?? new MockPiProviderManager();
	const prepareRealHome = deps.prepareRealHome ?? prepareWritablePiHome;

	return async (
		overrides: ManagedPiSessionOverrides = {},
	): Promise<PiSessionPort> => {
		const {
			strictReal = false,
			bootstrapTimeoutMs: baseBootstrapTimeoutMs,
			mockBootstrapTimeoutMs: baseMockBootstrapTimeoutMs = 5_000,
			...baseSessionInput
		} = input;
		const {
			bootstrapTimeoutMs = baseBootstrapTimeoutMs ??
				(strictReal ? 10_000 : 1_500),
			mockBootstrapTimeoutMs = baseMockBootstrapTimeoutMs,
			...sessionOverrides
		} = overrides;
		const sessionInput = {
			...baseSessionInput,
			...sessionOverrides,
		};
		const realSessionInput = {
			...sessionInput,
			homeOverride: sessionInput.homeOverride ?? (await prepareRealHome()),
		};
		let realSession: PiSessionPort | null = null;

		try {
			realSession = createSessionPort(realSessionInput);
			await awaitWithTimeout(
				realSession.getState(),
				bootstrapTimeoutMs,
				"real pi bootstrap",
			);
			return realSession;
		} catch (error) {
			await safeClose(realSession);
			if (strictReal) {
				throw error;
			}
		}

		const lease = await mockProviderManager.acquire();
		let mockSession: PiSessionPort | null = null;
		try {
			mockSession = createSessionPort({
				...sessionInput,
				provider: lease.provider,
				model: lease.model,
				homeOverride: lease.homeOverride,
			});
			await awaitWithTimeout(
				mockSession.getState(),
				mockBootstrapTimeoutMs,
				"mock pi bootstrap",
			);
			return new ManagedPiSessionPort(mockSession, () => lease.release());
		} catch (error) {
			await safeClose(mockSession);
			await lease.release();
			throw error;
		}
	};
}

export async function probePiSession(
	createSession: (
		overrides?: ManagedPiSessionOverrides,
	) => Promise<PiSessionPort>,
): Promise<boolean> {
	let session: PiSessionPort | null = null;
	try {
		session = await createSession();
		return true;
	} catch {
		return false;
	} finally {
		await safeClose(session);
	}
}
