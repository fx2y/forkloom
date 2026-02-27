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

	async waitUntilIdle(): Promise<void> {
		return;
	}

	async close(): Promise<void> {
		this.closed = true;
		this.onClose?.();
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
		});

		const session = await createSession();

		expect(real.closed).toBe(true);
		expect(acquire).toHaveBeenCalledTimes(1);
		expect(createSessionPort).toHaveBeenNthCalledWith(1, baseInput());
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
			},
		);

		await expect(createSession()).rejects.toThrow("missing auth");
		expect(acquire).not.toHaveBeenCalled();
	});

	it("reports false when probing an unavailable session factory", async () => {
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
			},
		);

		await expect(probePiSession(createSession)).resolves.toBe(false);
	});
});
