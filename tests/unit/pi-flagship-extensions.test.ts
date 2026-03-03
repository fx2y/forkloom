import { describe, expect, it, vi } from "vitest";
import { ExtensionService } from "../../apps/api/src/pi/extensions";
import artifactWidget from "../../extensions/artifact-widget/index";
import structuredWizard from "../../extensions/structured-wizard/index";
import willRun from "../../extensions/will-run/index";

describe("flagship extensions", () => {
	it("WILL-RUN blocks risky calls in headless mode", async () => {
		const service = new ExtensionService({
			discover: async () => ({
				files: ["/ext/will-run.ts"],
				warnings: [],
				roots: [],
				settingsFiles: [],
			}),
			loadModule: async () => ({ default: willRun }),
		});
		await service.loadAll();
		const decision = await service.emitToolCall({
			runId: "run-1",
			toolName: "skill_exec",
			commandKind: "prompt",
			input: { scripts: ["rm -rf /tmp/proof"] },
		});
		expect(decision).toEqual({ blocked: true, reason: "headless-risk-denied" });
	});

	it("structured wizard injects deterministic form payload only when UI exists", async () => {
		const input = vi
			.fn<(message: string) => Promise<string | undefined>>()
			.mockImplementation(async (message) =>
				message.includes("client") ? "acme" : "2026-03-31",
			);
		const service = new ExtensionService({
			hasUI: true,
			ui: { input },
			discover: async () => ({
				files: ["/ext/wizard.ts"],
				warnings: [],
				roots: [],
				settingsFiles: [],
			}),
			loadModule: async () => ({ default: structuredWizard }),
		});
		await service.loadAll();
		const out = await service.emitBeforeAgentStart({
			runId: "run-1",
			commandKind: "prompt",
			text: "Please prepare proposal",
		});
		expect(out.text).toBe(
			"Please prepare proposal\n[form:{\"client\":\"acme\",\"deadline\":\"2026-03-31\"}]",
		);
	});

	it("artifact widget publishes widget/status from tool_result artifact pointer", async () => {
		const setWidget = vi.fn<(key: string, lines: string[]) => void>();
		const setStatus = vi.fn<(key: string, message: string) => void>();
		const service = new ExtensionService({
			hasUI: true,
			ui: { setWidget, setStatus },
			discover: async () => ({
				files: ["/ext/widget.ts"],
				warnings: [],
				roots: [],
				settingsFiles: [],
			}),
			loadModule: async () => ({ default: artifactWidget }),
		});
		await service.loadAll();
		await service.emitToolResult({
			runId: "run-1",
			toolName: "skill_exec",
			commandKind: "prompt",
			result: { details: { artifactSha: "a".repeat(64) } },
		});
		expect(setStatus).toHaveBeenCalledWith("artifact", expect.stringContaining("aaaaaaaaaaaa"));
		expect(setWidget).toHaveBeenCalledWith("artifact", [`sha:${"a".repeat(64)}`]);
	});
});
