import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillService, readPrefixBytes } from "../../apps/api/src/skill";

async function writeSkillFile(
	path: string,
	input: {
		name: string;
		description?: string | undefined;
		disableModelInvocation?: boolean | undefined;
	},
): Promise<void> {
	const lines = ["---", `name: ${input.name}`];
	if (input.description != null) {
		lines.push(`description: ${input.description}`);
	}
	if (input.disableModelInvocation) {
		lines.push("disable-model-invocation: true");
	}
	lines.push("---", "# body");
	await writeFile(path, `${lines.join("\n")}\n`, "utf8");
}

describe("SkillService L1 registry", () => {
	it("enforces precedence and first-wins collisions deterministically", async () => {
		const root = await mkdtemp(join(tmpdir(), "skill-registry-"));
		try {
			const orgRoot = join(root, "org");
			const workspaceRoot = join(root, "workspace");
			const userRoot = join(root, "user");
			await mkdir(join(orgRoot, "alpha"), { recursive: true });
			await mkdir(join(workspaceRoot, "alpha"), { recursive: true });
			await mkdir(userRoot, { recursive: true });

			await writeSkillFile(join(orgRoot, "alpha", "SKILL.md"), {
				name: "alpha",
				description: "org alpha",
			});
			await writeSkillFile(join(workspaceRoot, "alpha", "SKILL.md"), {
				name: "alpha",
				description: "workspace alpha",
			});
			await writeSkillFile(join(userRoot, "beta.md"), {
				name: "beta",
				description: "user beta",
			});
			await writeFile(
				join(workspaceRoot, "missing.md"),
				"---\nname: missing\n---\n# no description\n",
				"utf8",
			);

			const service = new SkillService({
				roots: [
					{ scope: "user", path: userRoot },
					{ scope: "workspace", path: workspaceRoot },
					{ scope: "org", path: orgRoot },
				],
			});

			const state = await service.getRegistryState();
			expect(state.entries.map((entry) => entry.name)).toEqual([
				"alpha",
				"beta",
			]);
			expect(state.entries[0]?.description).toBe("org alpha");
			expect(state.warnings.map((warning) => warning.code)).toEqual(
				expect.arrayContaining(["collision", "description_missing"]),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("reads bounded prefixes and reuses cache on unchanged stat", async () => {
		const root = await mkdtemp(join(tmpdir(), "skill-cache-"));
		try {
			const workspaceRoot = join(root, "workspace");
			await mkdir(join(workspaceRoot, "gamma"), { recursive: true });
			const skillPath = join(workspaceRoot, "gamma", "SKILL.md");
			await writeSkillFile(skillPath, {
				name: "gamma",
				description: "first version",
			});

			const readCalls: Array<{ path: string; maxBytes: number }> = [];
			const service = new SkillService({
				roots: [{ scope: "workspace", path: workspaceRoot }],
				prefixBytes: 128,
				readPrefix: async (path, maxBytes) => {
					readCalls.push({ path, maxBytes });
					return readPrefixBytes(path, maxBytes);
				},
			});

			await service.listSkills();
			await service.listSkills();
			expect(readCalls).toHaveLength(1);
			expect(readCalls[0]?.maxBytes).toBe(128);

			await writeSkillFile(skillPath, {
				name: "gamma",
				description: "second version with changed bytes",
			});
			const entries = await service.listSkills();
			expect(readCalls).toHaveLength(2);
			expect(entries[0]?.description).toBe("second version with changed bytes");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("emits stable prompt XML from L1 metadata only", async () => {
		const root = await mkdtemp(join(tmpdir(), "skill-xml-"));
		try {
			const workspaceRoot = join(root, "workspace");
			await mkdir(join(workspaceRoot, "alpha"), { recursive: true });
			await mkdir(join(workspaceRoot, "hidden"), { recursive: true });
			await writeSkillFile(join(workspaceRoot, "alpha", "SKILL.md"), {
				name: "alpha",
				description: `Use <alpha> & "beta" now ${"x".repeat(80)}`,
			});
			await writeSkillFile(join(workspaceRoot, "hidden", "SKILL.md"), {
				name: "hidden",
				description: "hidden skill",
				disableModelInvocation: true,
			});
			const service = new SkillService({
				roots: [{ scope: "workspace", path: workspaceRoot }],
				promptMaxDescriptionChars: 40,
			});
			const xml = await service.buildAvailableSkillsXml();
			expect(xml).toMatchInlineSnapshot(`
					"<available_skills>
					  <skill><name>alpha</name><description>Use &lt;alpha&gt; &amp; &quot;beta&quot; now xxxxxxxxxxxx...</description></skill>
					</available_skills>"
				`);
			expect(xml).not.toContain("hidden");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("keeps startup scans prefix-only (no SKILL.md full-body reads)", async () => {
		const source = await readFile(
			join(process.cwd(), "apps/api/src/skill/registry.ts"),
			"utf8",
		);
		expect(source).not.toMatch(/readFile\(/);
		expect(source).toMatch(/readPrefixBytes/);
	});
});
