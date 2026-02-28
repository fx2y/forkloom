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
>;

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
};

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

	return async (
		overrides: ManagedPiSessionOverrides = {},
	): Promise<PiSessionPort> => {
		const {
			strictReal = false,
			bootstrapTimeoutMs = 1_500,
			mockBootstrapTimeoutMs = 5_000,
			...baseSessionInput
		} = input;
		const sessionInput = {
			...baseSessionInput,
			...overrides,
		};
		let realSession: PiSessionPort | null = null;

		try {
			realSession = createSessionPort(sessionInput);
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
		await session.getState();
		return true;
	} catch {
		return false;
	} finally {
		await safeClose(session);
	}
}
