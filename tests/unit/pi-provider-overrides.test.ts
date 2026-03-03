import { describe, expect, it, vi } from "vitest";
import {
	buildProviderOverrideRegistry,
	resolveProviderOverride,
} from "../../apps/api/src/pi/providers";
import { createManagedPiSessionFactory } from "../../apps/api/src/pi/session-factory";

describe("provider overrides", () => {
	it("applies first-wins deterministic registry semantics", () => {
		const warnings: string[] = [];
		const registry = buildProviderOverrideRegistry({
			providers: [
				{
					ownerId: "ext-a",
					definition: {
						name: "github-copilot",
						value: { model: "corp/model-a" },
					},
				},
				{
					ownerId: "ext-b",
					definition: {
						name: "github-copilot",
						value: { model: "corp/model-b" },
					},
				},
			],
			onWarning: (message) => warnings.push(message),
		});
		const resolved = resolveProviderOverride({
			provider: "github-copilot",
			model: "gpt-4.1",
			overrides: registry,
		});
		expect(resolved.model).toBe("corp/model-a");
		expect(warnings[0]).toContain("provider override collision");
	});

	it("threads override map into session factory", async () => {
		const createSessionPort = vi.fn().mockReturnValue({
			getState: async () => ({
				sessionFile: "/tmp/s.jsonl",
				sessionId: "s1",
				isStreaming: false,
				pending: 0,
			}),
			close: async () => undefined,
			prompt: async () => undefined,
			steer: async () => undefined,
			followUp: async () => undefined,
			setQueueMode: async () => undefined,
			abort: async () => undefined,
			getLastAssistantText: async () => "",
			getSessionStats: async () => ({}),
			drainPendingEvents: () => [],
			waitUntilIdle: async () => undefined,
		});
		const createSession = createManagedPiSessionFactory(
			{ provider: "github-copilot", model: "gpt-4.1" },
			{
				createSessionPort,
				prepareRealHome: async () => "/tmp/home",
				providerOverrides: new Map([
					[
						"github-copilot",
						{
							name: "github-copilot",
							ownerId: "ext",
							value: { model: "corp/model" },
						},
					],
				]),
			},
		);
		const session = await createSession();
		expect(createSessionPort).toHaveBeenCalledWith(
			expect.objectContaining({ model: "corp/model" }),
		);
		await session.close();
	});
});
