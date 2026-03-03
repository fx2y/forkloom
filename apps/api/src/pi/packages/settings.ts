import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { resolvePackageSource } from "./resolver";
import type {
	MergedPackageSettingsEntry,
	PackageScope,
	PackageSettingsEntry,
	PackageSettingsModel,
} from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asStringArray(value: unknown, label: string): string[] | undefined {
	if (value == null) {
		return undefined;
	}
	if (!Array.isArray(value)) {
		throw new Error(`${label} must be an array`);
	}
	return value.map((entry, index) => {
		if (typeof entry !== "string" || entry.trim().length === 0) {
			throw new Error(`${label}[${index}] must be a non-empty string`);
		}
		return entry.trim();
	});
}

function normalizePackageEntry(
	value: unknown,
	index: number,
): PackageSettingsEntry {
	if (typeof value === "string") {
		return { source: value.trim() };
	}
	if (!isRecord(value)) {
		throw new Error(`packages[${index}] must be string or object`);
	}
	const source = value.source;
	if (typeof source !== "string" || source.trim().length === 0) {
		throw new Error(`packages[${index}].source must be a non-empty string`);
	}
	return {
		source: source.trim(),
		extensions: asStringArray(value.extensions, `packages[${index}].extensions`),
		skills: asStringArray(value.skills, `packages[${index}].skills`),
		prompts: asStringArray(value.prompts, `packages[${index}].prompts`),
		themes: asStringArray(value.themes, `packages[${index}].themes`),
	};
}

function normalizeResourceState(value: unknown): Record<string, boolean> {
	if (value == null) {
		return {};
	}
	if (!isRecord(value)) {
		throw new Error("resourceState must be an object");
	}
	const out: Record<string, boolean> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry !== "boolean") {
			throw new Error(`resourceState[${key}] must be boolean`);
		}
		out[key] = entry;
	}
	return out;
}

export function parsePackageSettingsText(text: string): PackageSettingsModel {
	const parsed = JSON.parse(text) as unknown;
	if (!isRecord(parsed)) {
		throw new Error("settings root must be an object");
	}
	const packagesRaw = parsed.packages;
	if (packagesRaw == null) {
		return {
			packages: [],
			resourceState: normalizeResourceState(parsed.resourceState),
		};
	}
	if (!Array.isArray(packagesRaw)) {
		throw new Error("packages must be an array");
	}
	return {
		packages: packagesRaw.map((entry, index) =>
			normalizePackageEntry(entry, index),
		),
		resourceState: normalizeResourceState(parsed.resourceState),
	};
}

export async function readPackageSettingsFile(
	path: string,
): Promise<PackageSettingsModel> {
	const raw = await readFile(path, "utf8").catch((error) => {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") {
			return "{}";
		}
		throw error;
	});
	return parsePackageSettingsText(raw);
}

export async function writePackageSettingsFile(input: {
	path: string;
	model: PackageSettingsModel;
}): Promise<void> {
	await mkdir(dirname(input.path), { recursive: true });
	const normalized: Record<string, unknown> = {};
	if (input.model.packages.length > 0) {
		normalized.packages = input.model.packages;
	}
	if (
		input.model.resourceState &&
		Object.keys(input.model.resourceState).length > 0
	) {
		normalized.resourceState = input.model.resourceState;
	}
	await writeFile(`${resolve(input.path)}`, `${JSON.stringify(normalized, null, 2)}\n`);
}

export function mergeByIdentity(
	globalEntries: MergedPackageSettingsEntry[],
	projectEntries: MergedPackageSettingsEntry[],
): MergedPackageSettingsEntry[] {
	const globalById = new Map<string, MergedPackageSettingsEntry>();
	for (const entry of globalEntries) {
		if (!globalById.has(entry.identity)) {
			globalById.set(entry.identity, entry);
		}
	}
	for (const entry of projectEntries) {
		globalById.set(entry.identity, entry);
	}
	return [...globalById.values()].sort((left, right) =>
		left.identity.localeCompare(right.identity),
	);
}

export async function loadMergedPackageSettings(input: {
	globalSettingsPath: string;
	projectSettingsPath: string;
}): Promise<{
	merged: MergedPackageSettingsEntry[];
	global: PackageSettingsModel;
	project: PackageSettingsModel;
}> {
	const global = await readPackageSettingsFile(input.globalSettingsPath);
	const project = await readPackageSettingsFile(input.projectSettingsPath);

	const resolveEntries = async (
		entries: PackageSettingsEntry[],
		scope: PackageScope,
		settingsFile: string,
	): Promise<MergedPackageSettingsEntry[]> => {
		const resolved: MergedPackageSettingsEntry[] = [];
		for (const entry of entries) {
			const normalized = await resolvePackageSource({
				source: entry.source,
				settingsFile,
			});
			resolved.push({
				...entry,
				source: normalized.source,
				identity: normalized.identity,
				scope,
				settingsFile,
				resolved: normalized,
			});
		}
		resolved.sort((left, right) => {
			const identity = left.identity.localeCompare(right.identity);
			if (identity !== 0) {
				return identity;
			}
			return left.source.localeCompare(right.source);
		});
		const deduped: MergedPackageSettingsEntry[] = [];
		const seen = new Set<string>();
		for (const entry of resolved) {
			if (seen.has(entry.identity)) {
				continue;
			}
			seen.add(entry.identity);
			deduped.push(entry);
		}
		return deduped;
	};

	const merged = mergeByIdentity(
		await resolveEntries(global.packages, "global", input.globalSettingsPath),
		await resolveEntries(project.packages, "project", input.projectSettingsPath),
	);

	return { merged, global, project };
}
