import { describe, expect, it, vi } from "vitest";
import type {
	CreatePiSessionInput,
	PiSessionPort,
	PiSessionState,
	PiSessionStats,
} from "../../apps/api/src/pi";
import {
	createManagedPiSessionFactory,
	probePiSession,
} from "../../apps/api/src/pi/session-factory";

class StubSession implements PiSessionPort {
	public closed = false;

	constructor(
		private readonly stateResult: PiSessionState | Error,
		private readonly onClose?: (() => void) | undefined,
	) {}

	async prompt(): Promise<void> {
		return;
	}

	async steer(): Promise<void> {
		return;
	}

	async followUp(): Promise<void> {
		return;
	}

	async setQueueMode(): Promise<void> {
		return;
	}

	async abort(): Promise<void> {
		return;
	}

	async getState(): Promise<PiSessionState> {
		if (this.stateResult instanceof Error) {
			throw this.stateResult;
		}
		return this.stateResult;
	}

	async getLastAssistantText(): Promise<string> {
		return "ok";
	}

	async getSessionStats(): Promise<PiSessionStats> {
		return {};
	}

	drainPendingEvents(): Record<string, unknown>[] {
		return [];
	}

	async waitUntilIdle(): Promise<void> {
		return;
	}

	async close(): Promise<void> {
		this.closed = true;
		this.onClose?.();
	}
}

class DelayedSession extends StubSession {
	constructor(
		private readonly delayMs: number,
		stateResult: PiSessionState | Error,
		onClose?: (() => void) | undefined,
	) {
		super(stateResult, onClose);
	}

	async getState(): Promise<PiSessionState> {
		await new Promise((resolve) => {
			setTimeout(resolve, this.delayMs);
		});
		return super.getState();
	}
}

const READY_STATE: PiSessionState = {
	sessionFile: "/tmp/session.jsonl",
	sessionId: "session-1",
	isStreaming: false,
	pending: 0,
};

function baseInput(): CreatePiSessionInput {
	return {
		provider: "github-copilot",
		model: "gpt-4.1",
	};
}

describe("createManagedPiSessionFactory", () => {
	it("falls back to the mock provider and releases it on close", async () => {
		const real = new StubSession(new Error("missing auth"));
		const mock = new StubSession(READY_STATE);
		const release = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
		const prepareRealHome = vi
			.fn<() => Promise<string>>()
			.mockResolvedValue("/tmp/forkloom-pi-real-home");
		const createSessionPort = vi
			.fn<(input: CreatePiSessionInput) => PiSessionPort>()
			.mockImplementationOnce(() => real)
			.mockImplementationOnce(() => mock);
		const acquire = vi.fn().mockResolvedValue({
			provider: "forkloom-mock",
			model: "forkloom-mock/forkloom-mock-1",
			homeOverride: "/tmp/forkloom-pi-home",
			release,
		});

		const createSession = createManagedPiSessionFactory(baseInput(), {
			createSessionPort,
			mockProviderManager: { acquire } as never,
			prepareRealHome,
		});

		const session = await createSession();

		expect(real.closed).toBe(true);
		expect(prepareRealHome).toHaveBeenCalledTimes(1);
		expect(acquire).toHaveBeenCalledTimes(1);
		expect(createSessionPort).toHaveBeenNthCalledWith(1, {
			...baseInput(),
			homeOverride: "/tmp/forkloom-pi-real-home",
		});
		expect(createSessionPort).toHaveBeenNthCalledWith(2, {
			...baseInput(),
			provider: "forkloom-mock",
			model: "forkloom-mock/forkloom-mock-1",
			homeOverride: "/tmp/forkloom-pi-home",
		});

		await session.close();
		expect(mock.closed).toBe(true);
		expect(release).toHaveBeenCalledTimes(1);
	});

	it("throws the real session error when strictReal is enabled", async () => {
		const prepareRealHome = vi
			.fn<() => Promise<string>>()
			.mockResolvedValue("/tmp/forkloom-pi-real-home");
		const createSessionPort = vi
			.fn<(input: CreatePiSessionInput) => PiSessionPort>()
			.mockReturnValue(new StubSession(new Error("missing auth")));
		const acquire = vi.fn();

		const createSession = createManagedPiSessionFactory(
			{
				...baseInput(),
				strictReal: true,
			},
			{
				createSessionPort,
				mockProviderManager: { acquire } as never,
				prepareRealHome,
			},
		);

		await expect(createSession()).rejects.toThrow("missing auth");
		expect(acquire).not.toHaveBeenCalled();
	});

	it("allows slower real bootstrap when strictReal is enabled", async () => {
		const prepareRealHome = vi
			.fn<() => Promise<string>>()
			.mockResolvedValue("/tmp/forkloom-pi-real-home");
		const createSessionPort = vi
			.fn<(input: CreatePiSessionInput) => PiSessionPort>()
			.mockReturnValue(new DelayedSession(2_000, READY_STATE));

		const createSession = createManagedPiSessionFactory(
			{
				...baseInput(),
				strictReal: true,
			},
			{
				createSessionPort,
				prepareRealHome,
			},
		);

		const session = await createSession();
		await expect(session.getState()).resolves.toEqual(READY_STATE);
		await session.close();
	});

	it("reports false when probing an unavailable session factory", async () => {
		const prepareRealHome = vi
			.fn<() => Promise<string>>()
			.mockResolvedValue("/tmp/forkloom-pi-real-home");
		const createSessionPort = vi
			.fn<(input: CreatePiSessionInput) => PiSessionPort>()
			.mockReturnValue(new StubSession(new Error("missing auth")));
		const createSession = createManagedPiSessionFactory(
			{
				...baseInput(),
				strictReal: true,
			},
			{
				createSessionPort,
				prepareRealHome,
			},
		);

		await expect(probePiSession(createSession)).resolves.toBe(false);
	});

	it("reports true when the managed session factory returns a ready session", async () => {
		const prepareRealHome = vi
			.fn<() => Promise<string>>()
			.mockResolvedValue("/tmp/forkloom-pi-real-home");
		const createSessionPort = vi
			.fn<(input: CreatePiSessionInput) => PiSessionPort>()
			.mockReturnValue(new StubSession(READY_STATE));
		const createSession = createManagedPiSessionFactory(baseInput(), {
			createSessionPort,
			prepareRealHome,
		});

		await expect(probePiSession(createSession)).resolves.toBe(true);
	});
});
