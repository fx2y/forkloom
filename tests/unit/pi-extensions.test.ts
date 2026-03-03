import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ExtensionService,
	discoverExtensionFiles,
} from "../../apps/api/src/pi/extensions";

async function write(path: string, body: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, body, "utf8");
}

describe("extension discovery", () => {
	it("discovers global+project roots plus settings paths deterministically", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "forkloom-ext-discovery-"));
		const homeDir = resolve(root, "home");
		const cwd = resolve(root, "workspace");
		const globalRoot = resolve(homeDir, ".pi/agent/extensions");
		const projectRoot = resolve(cwd, ".pi/extensions");
		const globalSettings = resolve(homeDir, ".pi/agent/settings.json");
		const projectSettings = resolve(cwd, ".pi/settings.json");

		await write(resolve(globalRoot, "z-home.ts"), "export default () => {};\n");
		await write(resolve(globalRoot, "a-home.ts"), "export default () => {};\n");
		await write(
			resolve(projectRoot, "p-project.ts"),
			"export default () => {};\n",
		);
		await write(
			resolve(homeDir, ".pi/agent/ext-extra/e-extra.ts"),
			"export default () => {};\n",
		);
		await write(
			resolve(cwd, ".pi/ext-local/l-local.ts"),
			"export default () => {};\n",
		);

		await write(
			globalSettings,
			JSON.stringify({
				extensions: ["./ext-extra", "./extensions/a-home.ts"],
			}),
		);
		await write(
			projectSettings,
			JSON.stringify({
				extensions: ["./ext-local/l-local.ts"],
			}),
		);

		const discovered = await discoverExtensionFiles({ cwd, homeDir });
		expect(discovered.files.map((path) => path.slice(root.length + 1))).toEqual(
			[
				"home/.pi/agent/extensions/a-home.ts",
				"home/.pi/agent/extensions/z-home.ts",
				"workspace/.pi/extensions/p-project.ts",
				"home/.pi/agent/ext-extra/e-extra.ts",
				"workspace/.pi/ext-local/l-local.ts",
			],
		);
		expect(discovered.warnings).toEqual([]);
	});
});

describe("ExtensionService", () => {
	it("keeps deterministic hook order and first blocking reason", async () => {
		const disposeCalls: string[] = [];
		let version = 1;
		const files = ["/ext/a.ts", "/ext/b.ts"];
		const service = new ExtensionService({
			discover: async () => ({
				files,
				warnings: [],
				roots: [],
				settingsFiles: [],
			}),
			loadModule: async (path: string) => {
				if (path === "/ext/a.ts") {
					const mark = `a-v${version}`;
					return {
						default: (api) => {
							api.registerTool({ name: `tool-a-v${version}` });
							api.on("context", (payload) => ({
								text: `${payload.text}|a${version}`,
							}));
							api.on("tool_call", () => ({ block: true, reason: "deny-a" }));
							return () => {
								disposeCalls.push(mark);
							};
						},
					};
				}
				const mark = `b-v${version}`;
				return {
					default: (api) => {
						api.registerTool({ name: `tool-b-v${version}` });
						api.on("context", (payload) => ({
							text: `${payload.text}|b${version}`,
						}));
						api.on("tool_call", () => ({ block: true, reason: "deny-b" }));
						return () => {
							disposeCalls.push(mark);
						};
					},
				};
			},
		});

		await service.loadAll();
		const contextV1 = await service.emitContext({
			runId: "run-1",
			commandKind: "prompt",
			text: "ctx",
		});
		expect(contextV1.text).toBe("ctx|a1|b1");
		const toolDecision = await service.emitToolCall({
			runId: "run-1",
			toolName: "skill_exec",
			commandKind: "prompt",
			input: {},
		});
		expect(toolDecision).toEqual({ blocked: true, reason: "deny-a" });
		expect(service.getSnapshot().toolNames).toEqual(["tool-a-v1", "tool-b-v1"]);

		version = 2;
		const reload = await service.reload();
		expect(reload.reloaded).toBe(true);
		expect(disposeCalls).toEqual(["b-v1", "a-v1"]);
		expect(service.getSnapshot().toolNames).toEqual(["tool-a-v2", "tool-b-v2"]);
		const contextV2 = await service.emitContext({
			runId: "run-1",
			commandKind: "followUp",
			text: "ctx",
		});
		expect(contextV2.text).toBe("ctx|a2|b2");
	});

	it("guards ctx.ui when host runs headless", async () => {
		const service = new ExtensionService({
			discover: async () => ({
				files: ["/ext/ui.ts"],
				warnings: [],
				roots: [],
				settingsFiles: [],
			}),
			loadModule: async () => ({
				default: (api) => {
					api.on("context", (payload) => {
						api.ui.notify("no-ui");
						return payload;
					});
					return undefined;
				},
			}),
		});
		await service.loadAll();
		await expect(
			service.emitContext({
				runId: "run-1",
				commandKind: "prompt",
				text: "ctx",
			}),
		).rejects.toThrow("ctx.ui is unavailable in headless mode");
	});
});
