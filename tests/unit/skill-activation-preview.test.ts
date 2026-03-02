import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillService } from "../../apps/api/src/skill";

async function writeSkill(
	skillDir: string,
	input: {
		name: string;
		description: string;
		disableModelInvocation?: boolean | undefined;
		userInvocable?: boolean | undefined;
		allowedTools?: string[] | undefined;
		body: string;
	},
): Promise<void> {
	await mkdir(skillDir, { recursive: true });
	const lines = [
		"---",
		`name: ${input.name}`,
		`description: ${input.description}`,
	];
	if (input.disableModelInvocation) {
		lines.push("disable-model-invocation: true");
	}
	if (input.userInvocable === false) {
		lines.push("user-invocable: false");
	}
	if (input.allowedTools && input.allowedTools.length > 0) {
		lines.push("allowed-tools:");
		for (const tool of input.allowedTools) {
			lines.push(`  - ${tool}`);
		}
	}
	lines.push("---", input.body);
	await writeFile(join(skillDir, "SKILL.md"), `${lines.join("\n")}\n`, "utf8");
}

describe("SkillService activation + preview", () => {
	it("activates explicit hidden skills and expands $ARGUMENTS once", async () => {
		const root = await mkdtemp(join(tmpdir(), "skill-activation-hidden-"));
		try {
			const workspaceRoot = join(root, "workspace");
			const hiddenDir = join(workspaceRoot, "hidden-workflow");
			await writeSkill(hiddenDir, {
				name: "hidden-workflow",
				description: "manual-only flow",
				disableModelInvocation: true,
				body: '# hidden\nRun scripts/apply.sh "$ARGUMENTS"',
			});

			let readCount = 0;
			const service = new SkillService({
				roots: [{ scope: "workspace", path: workspaceRoot }],
				readSkillFile: async (path) => {
					readCount += 1;
					return readFile(path, "utf8");
				},
			});

			expect(await service.hasSkill("hidden-workflow")).toBe(true);
			const resolved = await service.resolvePromptText({
				text: "/skill:hidden-workflow extract invoices",
				activationKind: "explicit",
			});
			expect(resolved).toContain("extract invoices");
			expect(resolved).not.toContain("$ARGUMENTS");
			expect(resolved).not.toContain("/skill:hidden-workflow");
			expect(readCount).toBe(1);

			const xml = await service.buildAvailableSkillsXml();
			expect(xml).not.toContain("hidden-workflow");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("appends deterministic args when skill body has no $ARGUMENTS token", async () => {
		const root = await mkdtemp(join(tmpdir(), "skill-activation-args-"));
		try {
			const workspaceRoot = join(root, "workspace");
			const skillDir = join(workspaceRoot, "policy-qa");
			await writeSkill(skillDir, {
				name: "policy-qa",
				description: "policy checks",
				body: "# policy\nReturn checklist and citations.",
			});
			const service = new SkillService({
				roots: [{ scope: "workspace", path: workspaceRoot }],
			});
			const resolved = await service.resolvePromptText({
				text: "/skill:policy-qa region=us",
			});
			expect(resolved).toContain("Return checklist and citations.");
			expect(resolved).toContain("User: region=us");
			await expect(
				service.resolvePromptText({
					text: "/skill:missing-skill x",
				}),
			).rejects.toThrow("skill not found: missing-skill");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("returns execution plan scripts from resolved /skill prompt", async () => {
		const root = await mkdtemp(join(tmpdir(), "skill-activation-plan-"));
		try {
			const workspaceRoot = join(root, "workspace");
			const skillDir = join(workspaceRoot, "policy-qa");
			await writeSkill(skillDir, {
				name: "policy-qa",
				description: "policy checks",
				body: [
					"# policy",
					"Run [primary](scripts/run.sh) then [helper](scripts/helpers/fix.sh).",
				].join("\n"),
			});
			const service = new SkillService({
				roots: [{ scope: "workspace", path: workspaceRoot }],
			});
			const resolved = await service.resolvePrompt({
				text: "/skill:policy-qa region=us",
			});
			expect(resolved.text).toContain("region=us");
			expect(resolved.execution).toEqual({
				skillName: "policy-qa",
				skillPath: join(skillDir, "SKILL.md"),
				argsText: "region=us",
				scripts: ["scripts/helpers/fix.sh", "scripts/run.sh"],
			});
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("builds read-only preview from body links + scripts without execution", async () => {
		const root = await mkdtemp(join(tmpdir(), "skill-preview-"));
		try {
			const workspaceRoot = join(root, "workspace");
			const skillDir = join(workspaceRoot, "policy-qa");
			await writeSkill(skillDir, {
				name: "policy-qa",
				description: "policy checks",
				userInvocable: false,
				allowedTools: ["Read", "Bash(node *)"],
				body: [
					"# policy-qa",
					"Use [guide](references/guide.md) and [asset](assets/logo.svg).",
					"See [runner](scripts/build.sh) and [external](https://example.com).",
				].join("\n"),
			});
			await mkdir(join(skillDir, "references"), { recursive: true });
			await mkdir(join(skillDir, "assets"), { recursive: true });
			await mkdir(join(skillDir, "scripts", "helpers"), { recursive: true });
			await writeFile(
				join(skillDir, "scripts", "build.sh"),
				"#!/usr/bin/env bash\n",
			);
			await writeFile(
				join(skillDir, "scripts", "helpers", "prepare.sh"),
				"#!/usr/bin/env bash\n",
			);
			const service = new SkillService({
				roots: [{ scope: "workspace", path: workspaceRoot }],
			});

			const preview = await service.previewSkill({
				skillName: "policy-qa",
			});
			expect(preview).not.toBeNull();
			expect(preview?.menuVisible).toBe(false);
			expect(preview?.manualOnly).toBe(false);
			expect(preview?.allowedTools).toEqual(["Read", "Bash(node *)"]);
			expect(preview?.scripts).toEqual([
				"scripts/build.sh",
				"scripts/helpers/prepare.sh",
			]);
			expect(preview?.touchedPaths).toEqual([
				"assets/logo.svg",
				"references/guide.md",
				"scripts/build.sh",
				"scripts/helpers/prepare.sh",
			]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
