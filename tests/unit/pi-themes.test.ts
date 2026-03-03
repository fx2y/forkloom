import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	ThemeService,
	resolveActiveTheme,
	validateTheme,
} from "../../apps/api/src/pi/themes";

describe("pi themes", () => {
	it("rejects missing required tokens loudly", () => {
		const out = validateTheme({
			name: "bad",
			vars: { primary: "#111", secondary: 0 },
			colors: {
				accent: "primary",
				border: "primary",
				text: "#fff",
				error: "#f00",
				success: "#0f0",
			},
		});
		expect(out.ok).toBe(false);
		if (out.ok) {
			throw new Error("expected invalid theme");
		}
		expect(out.errors.join(" ")).toContain("colors.bashMode invalid");
	});

	it("resolves active theme deterministically by precedence + settings", () => {
		const selected = resolveActiveTheme({
			settingsTheme: "team",
			candidates: [
				{ source: "builtin", name: "default", path: "/builtin/default.json" },
				{ source: "global", name: "team", path: "/global/team.json" },
				{ source: "project", name: "team", path: "/project/team.json" },
			],
		});
		expect(selected?.path).toBe("/global/team.json");
	});

	it("reloads only the active theme file via watcher callback", async () => {
		const root = await mkdtemp(resolve(tmpdir(), "forkloom-theme-"));
		const activePath = resolve(root, "active.json");
		const inactivePath = resolve(root, "inactive.json");
		const baseTheme = JSON.stringify({
			name: "active",
			vars: { primary: "#000", secondary: 0 },
			colors: {
				accent: "primary",
				border: "primary",
				text: "#fff",
				error: "#f00",
				success: "#0f0",
				bashMode: "#ff0",
			},
		});
		await writeFile(activePath, baseTheme, "utf8");
		await writeFile(inactivePath, baseTheme, "utf8");

		let onReload: (() => Promise<void> | void) | null = null;
		const watched: string[] = [];
		const service = new ThemeService({
			watchFile: (input) => {
				onReload = input.onReload;
				watched.push(input.path);
				return { close: () => undefined };
			},
		});
		service.setCandidates([
			{ source: "project", name: "active", path: activePath },
			{ source: "project", name: "inactive", path: inactivePath },
		]);
		service.setSelection({ settingsTheme: "active" });
		await service.reloadSelection();
		expect(watched).toEqual([activePath]);

		await writeFile(
			activePath,
			JSON.stringify({
				name: "active",
				vars: { primary: "#222", secondary: 0 },
				colors: {
					accent: "primary",
					border: "primary",
					text: "#fff",
					error: "#f00",
					success: "#0f0",
					bashMode: "#ff0",
				},
			}),
			"utf8",
		);
		await onReload?.();
		expect(service.getActiveTheme()?.vars.primary).toBe("#222");
	});
});
