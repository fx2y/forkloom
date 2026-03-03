import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { applyFilterRules } from "./filter";
import { PACKAGE_RESOURCE_KINDS, type PackageManifestDescriptor } from "./types";

type PackageJsonPi = {
	extensions?: string[] | undefined;
	skills?: string[] | undefined;
	prompts?: string[] | undefined;
	themes?: string[] | undefined;
};

type PackageJson = {
	name?: unknown;
	version?: unknown;
	keywords?: unknown;
	pi?: unknown;
	dependencies?: unknown;
	peerDependencies?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeGlobInput(value: unknown, label: string): string[] {
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array`);
	}
	const out: string[] = [];
	for (const entry of value) {
		if (typeof entry !== "string" || entry.trim().length === 0) {
			throw new Error(`${label} must contain non-empty strings`);
		}
		out.push(entry.trim().replace(/\\/g, "/").replace(/^\.\/+/, ""));
	}
	return out;
}

function globToRegex(pattern: string): RegExp {
	let out = "^";
	for (let index = 0; index < pattern.length; index += 1) {
		const char = pattern[index];
		if (!char) {
			continue;
		}
		if (char === "*") {
			if (pattern[index + 1] === "*") {
				index += 1;
				if (pattern[index + 1] === "/") {
					out += "(?:.*/)?";
					index += 1;
				} else {
					out += ".*";
				}
			} else {
				out += "[^/]*";
			}
			continue;
		}
		if ("|\\{}()[\]^$+?. ".includes(char)) {
			out += `\\${char}`;
			continue;
		}
		out += char;
	}
	out += "$";
	return new RegExp(out);
}

async function walkFiles(root: string): Promise<string[]> {
	const out: string[] = [];
	const stack = [root];
	while (stack.length > 0) {
		const current = stack.pop();
		if (!current) {
			continue;
		}
		let entries: Array<{
			name: string;
			isDirectory(): boolean;
			isFile(): boolean;
		}>;
		try {
			entries = await readdir(current, {
				withFileTypes: true,
				encoding: "utf8",
			});
		} catch {
			continue;
		}
		entries.sort((left, right) => left.name.localeCompare(right.name));
		for (const entry of entries) {
			const abs = join(current, entry.name);
			if (entry.isDirectory()) {
				stack.push(abs);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			out.push(relative(root, abs).replace(/\\/g, "/"));
		}
	}
	out.sort((left, right) => left.localeCompare(right));
	return out;
}

function conventionRules(): Record<(typeof PACKAGE_RESOURCE_KINDS)[number], string[]> {
	return {
		extensions: ["extensions/**/*.ts", "extensions/**/*.js"],
		skills: ["skills/**/SKILL.md"],
		prompts: ["prompts/**/*.md"],
		themes: ["themes/**/*.json"],
	};
}

function parsePiManifest(value: unknown): PackageJsonPi | null {
	if (value == null) {
		return null;
	}
	if (!isRecord(value)) {
		throw new Error("package.json pi must be an object");
	}
	return value;
}

function validateDependencyPolicy(pkg: PackageJson): void {
	const dependencies = isRecord(pkg.dependencies) ? pkg.dependencies : {};
	const peerDependencies = isRecord(pkg.peerDependencies)
		? pkg.peerDependencies
		: {};
	for (const dependencyName of Object.keys(dependencies)) {
		if (
			dependencyName.startsWith("@mariozechner/pi-") ||
			dependencyName === "@sinclair/typebox"
		) {
			if (!(dependencyName in peerDependencies)) {
				throw new Error(
					`dependency policy violation: ${dependencyName} must be in peerDependencies`,
				);
			}
		}
	}
}

export async function parsePackageManifest(input: {
	packageRoot: string;
	filter?: Partial<Record<(typeof PACKAGE_RESOURCE_KINDS)[number], string[]>>;
}): Promise<PackageManifestDescriptor> {
	const packageRoot = resolve(input.packageRoot);
	const packageJsonPath = resolve(packageRoot, "package.json");
	const packageJson = JSON.parse(
		await readFile(packageJsonPath, "utf8"),
	) as PackageJson;
	if (typeof packageJson.name !== "string" || packageJson.name.length === 0) {
		throw new Error(`invalid package.json name: ${packageJsonPath}`);
	}
	if (
		typeof packageJson.version !== "string" ||
		packageJson.version.length === 0
	) {
		throw new Error(`invalid package.json version: ${packageJsonPath}`);
	}
	validateDependencyPolicy(packageJson);
	const pi = parsePiManifest(packageJson.pi);
	const rules = conventionRules();
	if (pi) {
		for (const kind of PACKAGE_RESOURCE_KINDS) {
			const raw = pi[kind];
			if (raw == null) {
				continue;
			}
			rules[kind] = normalizeGlobInput(raw, `pi.${kind}`);
		}
	}
	const allFiles = await walkFiles(packageRoot);
	const resources: PackageManifestDescriptor["resources"] = {
		extensions: [],
		skills: [],
		prompts: [],
		themes: [],
	};
	for (const kind of PACKAGE_RESOURCE_KINDS) {
		const include = rules[kind].filter((entry) => !entry.startsWith("!"));
		if (include.length !== rules[kind].length) {
			throw new Error(`invalid ${kind} glob: ! exclusion is not valid in manifest`);
		}
		const candidates = allFiles.filter((file) =>
			include.some((pattern) => globToRegex(pattern).test(file)),
		);
		resources[kind] = applyFilterRules(candidates, input.filter?.[kind]);
	}
	return {
		packageRoot,
		packageName: packageJson.name,
		version: packageJson.version,
		resources,
	};
}
