import { describe, expect, it } from "vitest";
import {
	type ExtensionHookPayloadMap,
	ExtensionService,
} from "../../apps/api/src/pi/extensions";

describe("extension branch state log", () => {
	it("restores extension state from branch entries on start/tree/fork", async () => {
		const service = new ExtensionService({
			discover: async () => ({
				files: ["/ext/state.ts"],
				warnings: [],
				roots: [],
				settingsFiles: [],
			}),
			loadModule: async () => ({
				default: (api) => {
					let state = 0;
					const restore = async (
						payload:
							| ExtensionHookPayloadMap["session_start"]
							| ExtensionHookPayloadMap["session_tree"]
							| ExtensionHookPayloadMap["session_fork"],
					): Promise<undefined> => {
						for (const entry of payload.branchEntries ?? []) {
							const value = entry.value as Record<string, unknown>;
							if (value.kind === "ext-state" && value.key === "count") {
								state = Number(value.value ?? state);
							}
						}
						return undefined;
					};
					api.on("session_start", restore);
					api.on("session_tree", restore);
					api.on("session_fork", restore);
					api.on("context", (payload) => ({
						text: `${payload.text}:${state}`,
					}));
					return undefined;
				},
			}),
		});
		await service.loadAll();
		const seedEntries = [
			{
				ts: "2026-03-03T00:00:00.000Z",
				value: { kind: "ext-state", key: "count", value: 7 },
			},
		];
		await service.emitSessionStart({
			runId: "run-1",
			branchEntries: seedEntries,
		});
		await service.emitSessionTree({
			runId: "run-1",
			branchEntries: seedEntries,
		});
		await service.emitSessionFork({
			runId: "run-1",
			branchEntries: seedEntries,
		});
		const next = await service.emitContext({
			runId: "run-1",
			commandKind: "prompt",
			text: "ctx",
		});
		expect(next.text).toBe("ctx:7");
	});
});
