import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	PackageOps,
	applyFilterRules,
	buildPackageResourceRegistry,
	loadMergedPackageSettings,
	parsePackageManifest,
	projectActiveResources,
	readPackageSettingsFile,
	reconcileMissingPackages,
	resolvePackageSource,
	setResourceEnabled,
} from "../../apps/api/src/pi";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

afterEach(async () => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (!dir) {
			continue;
		}
		await rm(dir, { recursive: true, force: true });
	}
});

describe("package settings merge", () => {
	it("merges global+project by identity with project precedence", async () => {
		const root = await makeTempDir("forkloom-pkg-settings-");
		const globalSettingsPath = resolve(root, "home/.pi/agent/settings.json");
		const projectSettingsPath = resolve(root, "workspace/.pi/settings.json");
		await mkdir(resolve(root, "workspace/local/pkg-a"), { recursive: true });
		await mkdir(resolve(root, "home/.pi/agent/local/pkg-a"), {
			recursive: true,
		});
		await writeJson(globalSettingsPath, {
			packages: [
				"npm:@org/pkg-a@1.0.0",
				"npm:@org/pkg-a@1.2.0",
				"git:github.com/org/repo@v1",
				"./local/pkg-a",
			],
		});
		await writeJson(projectSettingsPath, {
			packages: ["npm:@org/pkg-a@2.0.0", "git:github.com/org/repo@v2"],
		});

		const loaded = await loadMergedPackageSettings({
			globalSettingsPath,
			projectSettingsPath,
		});
		expect(loaded.merged.map((entry) => [entry.identity, entry.scope])).toEqual(
			[
				["@org/pkg-a", "project"],
				[resolve(root, "home/.pi/agent/local/pkg-a"), "global"],
				["github.com/org/repo", "project"],
			],
		);
	});
});

describe("package source resolver", () => {
	it("normalizes npm/git/local identity and strips pins", async () => {
		const root = await makeTempDir("forkloom-pkg-resolver-");
		const settingsFile = resolve(root, ".pi/settings.json");
		await mkdir(resolve(root, "pkgs/local"), { recursive: true });
		const npm = await resolvePackageSource({
			source: "npm:@org/pkg-a@1.0.0",
			settingsFile,
		});
		const git = await resolvePackageSource({
			source: "git:github.com/org/repo@v1",
			settingsFile,
		});
		const local = await resolvePackageSource({
			source: resolve(root, "pkgs/local"),
			settingsFile: resolve(root, "team/settings.json"),
		});
		expect(npm.identity).toBe("@org/pkg-a");
		expect(npm.pinned).toBe(true);
		expect(git.identity).toBe("github.com/org/repo");
		expect(git.pinned).toBe(true);
		expect(local.kind).toBe("local");
		expect(local.identity).toBe(resolve(root, "pkgs/local"));
	});
});

describe("package ops", () => {
	it("writes install target by scope and keeps update pinned-safe", async () => {
		const root = await makeTempDir("forkloom-pkg-ops-");
		const globalSettingsPath = resolve(root, "home/.pi/agent/settings.json");
		const projectSettingsPath = resolve(root, "workspace/.pi/settings.json");
		await writeJson(globalSettingsPath, {
			packages: ["npm:@org/pkg-a@1.0.0"],
		});
		await writeJson(projectSettingsPath, {
			packages: ["git:github.com/org/repo@v1"],
		});
		const ops = new PackageOps({
			globalSettingsPath,
			projectSettingsPath,
		});
		await ops.install({ source: "npm:@org/pkg-b", scope: "project" });
		await ops.install({ source: "npm:@org/pkg-c" });
		const updated = await ops.update({
			onUpdate: async (entry) =>
				entry.source === "npm:@org/pkg-c" ? "npm:@org/pkg-c@latest" : null,
		});
		expect(updated.skippedPinned).toEqual([
			"@org/pkg-a",
			"github.com/org/repo",
		]);
		const global = await readPackageSettingsFile(globalSettingsPath);
		const project = await readPackageSettingsFile(projectSettingsPath);
		expect(global.packages.map((entry) => entry.source)).toEqual([
			"npm:@org/pkg-a@1.0.0",
			"npm:@org/pkg-c@latest",
		]);
		expect(project.packages.map((entry) => entry.source)).toEqual([
			"git:github.com/org/repo@v1",
			"npm:@org/pkg-b",
		]);
	});
});

describe("package manifest parser", () => {
	it("supports explicit pi globs and convention fallback", async () => {
		const root = await makeTempDir("forkloom-pkg-manifest-");
		const pkgExplicit = resolve(root, "explicit");
		const pkgConvention = resolve(root, "convention");
		await mkdir(resolve(pkgExplicit, "extensions"), { recursive: true });
		await mkdir(resolve(pkgExplicit, "skills/review"), { recursive: true });
		await mkdir(resolve(pkgConvention, "extensions"), { recursive: true });
		await mkdir(resolve(pkgConvention, "skills/review"), { recursive: true });
		await writeJson(resolve(pkgExplicit, "package.json"), {
			name: "@org/explicit",
			version: "0.1.0",
			pi: {
				extensions: ["extensions/**/*.ts"],
				skills: ["skills/**/SKILL.md"],
				prompts: ["prompts/**/*.md"],
				themes: ["themes/**/*.json"],
			},
		});
		await writeJson(resolve(pkgConvention, "package.json"), {
			name: "@org/convention",
			version: "0.1.0",
		});
		await writeFile(resolve(pkgExplicit, "extensions/a.ts"), "export {};\n");
		await writeFile(
			resolve(pkgExplicit, "skills/review/SKILL.md"),
			"# skill\n",
		);
		await writeFile(resolve(pkgConvention, "extensions/b.ts"), "export {};\n");
		await writeFile(
			resolve(pkgConvention, "skills/review/SKILL.md"),
			"# skill\n",
		);
		const explicit = await parsePackageManifest({ packageRoot: pkgExplicit });
		const convention = await parsePackageManifest({
			packageRoot: pkgConvention,
		});
		expect(explicit.resources.extensions).toEqual(["extensions/a.ts"]);
		expect(convention.resources.extensions).toEqual(["extensions/b.ts"]);
		expect(convention.resources.skills).toEqual(["skills/review/SKILL.md"]);
	});

	it("fails malformed pi config and policy violations", async () => {
		const root = await makeTempDir("forkloom-pkg-manifest-invalid-");
		const malformed = resolve(root, "malformed");
		const policy = resolve(root, "policy");
		await mkdir(malformed, { recursive: true });
		await mkdir(policy, { recursive: true });
		await writeJson(resolve(malformed, "package.json"), {
			name: "@org/malformed",
			version: "0.1.0",
			pi: { extensions: "extensions/**/*.ts" },
		});
		await writeJson(resolve(policy, "package.json"), {
			name: "@org/policy",
			version: "0.1.0",
			dependencies: { "@mariozechner/pi-core": "^1.0.0" },
			peerDependencies: {},
		});
		await expect(
			parsePackageManifest({ packageRoot: malformed }),
		).rejects.toThrow("pi.extensions must be an array");
		await expect(parsePackageManifest({ packageRoot: policy })).rejects.toThrow(
			"dependency policy violation",
		);
	});
});

describe("registry/filter/enable/startup", () => {
	it("applies deterministic registry + filter semantics + enable projection", async () => {
		const filtered = applyFilterRules(
			[
				"extensions/a.ts",
				"extensions/legacy.ts",
				"extensions/forced.ts",
				"extensions/extra.ts",
			],
			[
				"extensions/*.ts",
				"!extensions/legacy.ts",
				"-extensions/extra.ts",
				"+extensions/forced.ts",
			],
		);
		expect(filtered).toEqual(["extensions/a.ts", "extensions/forced.ts"]);

		const registry = buildPackageResourceRegistry({
			descriptors: [
				{
					packageIdentity: "pkg-global",
					packageScope: "global",
					manifest: {
						packageRoot: "/a",
						packageName: "a",
						version: "1.0.0",
						resources: {
							extensions: ["extensions/shared.ts"],
							skills: [],
							prompts: [],
							themes: [],
						},
					},
				},
				{
					packageIdentity: "pkg-project",
					packageScope: "project",
					manifest: {
						packageRoot: "/b",
						packageName: "b",
						version: "1.0.0",
						resources: {
							extensions: ["extensions/shared.ts", "extensions/project.ts"],
							skills: [],
							prompts: [],
							themes: [],
						},
					},
				},
			],
		});
		expect(
			registry
				.filter((record) => record.kind === "extensions")
				.map((record) => [record.path, record.packageIdentity]),
		).toEqual([
			["extensions/project.ts", "pkg-project"],
			["extensions/shared.ts", "pkg-project"],
		]);

		const root = await makeTempDir("forkloom-pkg-enable-");
		const settingsPath = resolve(root, ".pi/settings.json");
		await writeJson(settingsPath, {
			packages: ["npm:@org/pkg-a"],
		});
		await setResourceEnabled({
			settingsPath,
			identity: "pkg-project",
			kind: "extensions",
			path: "extensions/project.ts",
			enabled: false,
		});
		const settings = JSON.parse(await readFile(settingsPath, "utf8")) as {
			resourceState: Record<string, boolean>;
		};
		const active = projectActiveResources({
			inventory: registry.filter((record) => record.kind === "extensions"),
			resourceState: settings.resourceState,
		});
		expect(active.map((record) => record.path)).toEqual([
			"extensions/shared.ts",
		]);
	});

	it("retries startup install with bounded attempts", async () => {
		const entries = [
			{
				identity: "pkg-a",
				source: "npm:@org/pkg-a",
				scope: "global",
				settingsFile: "/tmp/settings.json",
				resolved: {
					kind: "npm",
					source: "npm:@org/pkg-a",
					identity: "@org/pkg-a",
					packageName: "@org/pkg-a",
					version: null,
					pinned: false,
				},
			},
		];
		let ready = false;
		const result = await reconcileMissingPackages({
			entries: entries as never,
			isInstalled: async () => ready,
			install: async () => {
				ready = true;
			},
			maxRetries: 3,
			pollMs: 1,
		});
		expect(result.attempts).toBe(2);
		expect(result.remainingMissing).toEqual([]);
	});
});
