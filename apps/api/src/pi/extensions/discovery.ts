import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, extname, resolve } from "node:path";
import type { ExtensionDiscovered, ExtensionDiscoveryOptions } from "./types";

const EXTENSION_FILE_EXTS = new Set([
	".ts",
	".js",
	".mts",
	".mjs",
	".cts",
	".cjs",
]);

function normalizeCandidatePath(
	candidate: string,
	cwd: string,
	homeDir: string,
): string {
	if (candidate.startsWith("~/")) {
		return resolve(homeDir, candidate.slice(2));
	}
	if (candidate.startsWith("/")) {
		return resolve(candidate);
	}
	return resolve(cwd, candidate);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await lstat(path);
		return true;
	} catch {
		return false;
	}
}

async function canonicalPath(path: string): Promise<string> {
	try {
		return await realpath(path);
	} catch {
		return resolve(path);
	}
}

function hasSupportedExtension(path: string): boolean {
	return EXTENSION_FILE_EXTS.has(extname(path).toLowerCase());
}

async function listExtensionFilesInDir(dirPath: string): Promise<string[]> {
	const out: string[] = [];
	await walkDir(dirPath, out);
	out.sort((left, right) => left.localeCompare(right));
	return out;
}

async function walkDir(dirPath: string, out: string[]): Promise<void> {
	let entries: Array<{
		name: string;
		isDirectory(): boolean;
		isFile(): boolean;
	}>;
	try {
		entries = await readdir(dirPath, {
			withFileTypes: true,
			encoding: "utf8",
		});
	} catch {
		return;
	}
	entries.sort((left, right) => left.name.localeCompare(right.name));
	for (const entry of entries) {
		const abs = resolve(dirPath, entry.name);
		if (entry.isDirectory()) {
			await walkDir(abs, out);
			continue;
		}
		if (!entry.isFile() || !hasSupportedExtension(abs)) {
			continue;
		}
		out.push(abs);
	}
}

async function parseSettingsExtensions(
	settingsFile: string,
	homeDir: string,
	warnings: string[],
): Promise<string[]> {
	let raw: string;
	try {
		raw = await readFile(settingsFile, "utf8");
	} catch {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		warnings.push(`settings parse failed (${settingsFile}): ${String(error)}`);
		return [];
	}
	if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
		warnings.push(`settings root must be object: ${settingsFile}`);
		return [];
	}
	const extensions = (parsed as Record<string, unknown>).extensions;
	if (extensions == null) {
		return [];
	}
	if (!Array.isArray(extensions)) {
		warnings.push(`settings.extensions must be array: ${settingsFile}`);
		return [];
	}
	const baseDir = dirname(settingsFile);
	const candidates: string[] = [];
	for (const value of extensions) {
		if (typeof value !== "string" || value.trim().length === 0) {
			warnings.push(
				`settings.extensions entry must be non-empty string: ${settingsFile}`,
			);
			continue;
		}
		const trimmed = value.trim();
		if (trimmed.startsWith("~/")) {
			candidates.push(resolve(homeDir, trimmed.slice(2)));
			continue;
		}
		if (trimmed.startsWith("/")) {
			candidates.push(resolve(trimmed));
			continue;
		}
		candidates.push(resolve(baseDir, trimmed));
	}
	return candidates;
}

export function defaultExtensionRoots(input?: {
	cwd?: string | undefined;
	homeDir?: string | undefined;
}): string[] {
	const cwd = input?.cwd ?? process.cwd();
	const homeDir = input?.homeDir ?? homedir();
	return [
		resolve(homeDir, ".pi/agent/extensions"),
		resolve(cwd, ".pi/extensions"),
	];
}

export function defaultExtensionSettingsFiles(input?: {
	cwd?: string | undefined;
	homeDir?: string | undefined;
}): string[] {
	const cwd = input?.cwd ?? process.cwd();
	const homeDir = input?.homeDir ?? homedir();
	return [
		resolve(homeDir, ".pi/agent/settings.json"),
		resolve(cwd, ".pi/settings.json"),
	];
}

export async function discoverExtensionFiles(
	options: ExtensionDiscoveryOptions = {},
): Promise<ExtensionDiscovered> {
	const cwd = options.cwd ?? process.cwd();
	const homeDir = options.homeDir ?? homedir();
	const roots = (options.roots ?? defaultExtensionRoots({ cwd, homeDir })).map(
		(root) => normalizeCandidatePath(root, cwd, homeDir),
	);
	const settingsFiles = (
		options.settingsFiles ?? defaultExtensionSettingsFiles({ cwd, homeDir })
	).map((path) => normalizeCandidatePath(path, cwd, homeDir));
	const warnings: string[] = [];
	const files: string[] = [];
	const seen = new Set<string>();

	const addFile = async (filePath: string): Promise<void> => {
		if (!hasSupportedExtension(filePath)) {
			return;
		}
		const canonical = await canonicalPath(filePath);
		if (seen.has(canonical)) {
			return;
		}
		seen.add(canonical);
		files.push(canonical);
	};

	for (const root of roots) {
		if (!(await pathExists(root))) {
			continue;
		}
		let stat: Awaited<ReturnType<typeof lstat>>;
		try {
			stat = await lstat(root);
		} catch {
			continue;
		}
		if (stat.isFile()) {
			await addFile(root);
			continue;
		}
		if (!stat.isDirectory()) {
			continue;
		}
		for (const filePath of await listExtensionFilesInDir(root)) {
			await addFile(filePath);
		}
	}

	for (const settingsFile of settingsFiles) {
		if (!(await pathExists(settingsFile))) {
			continue;
		}
		const candidates = await parseSettingsExtensions(
			settingsFile,
			homeDir,
			warnings,
		);
		for (const candidate of candidates) {
			if (!(await pathExists(candidate))) {
				warnings.push(
					`settings extension path missing (${settingsFile}): ${candidate}`,
				);
				continue;
			}
			let stat: Awaited<ReturnType<typeof lstat>>;
			try {
				stat = await lstat(candidate);
			} catch {
				continue;
			}
			if (stat.isFile()) {
				await addFile(candidate);
				continue;
			}
			if (stat.isDirectory()) {
				for (const filePath of await listExtensionFilesInDir(candidate)) {
					await addFile(filePath);
				}
			}
		}
	}

	return {
		files,
		warnings,
		roots,
		settingsFiles,
	};
}
