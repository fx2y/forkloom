import { readdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
	dedupeSorted as dedupeSortedPaths,
	listSkillLinkedPaths,
	toSkillRelativePath,
} from "./paths";

export type SkillPreviewSnapshot = {
	scripts: string[];
	touchedPaths: string[];
};

export async function buildSkillPreviewSnapshot(input: {
	skillPath: string;
	skillBody: string;
}): Promise<SkillPreviewSnapshot> {
	const skillDir = dirname(input.skillPath);
	const scripts = await listScriptFiles(skillDir);
	const linkedPaths = listSkillLinkedPaths(input.skillBody, skillDir);
	const touchedPaths = dedupeSortedPaths([...linkedPaths, ...scripts]);
	return {
		scripts,
		touchedPaths,
	};
}

async function listScriptFiles(skillDir: string): Promise<string[]> {
	const scriptDir = resolve(skillDir, "scripts");
	if (!(await isDirectory(scriptDir))) {
		return [];
	}
	const files: string[] = [];
	await walkFiles(scriptDir, files);
	return dedupeSortedPaths(
		files.map((path) => toSkillRelativePath(skillDir, path) ?? ""),
	);
}

async function walkFiles(dirPath: string, out: string[]): Promise<void> {
	let entries: Awaited<ReturnType<typeof readdir>> = [];
	try {
		entries = await readdir(dirPath, { withFileTypes: true });
	} catch {
		return;
	}
	entries.sort((left, right) => left.name.localeCompare(right.name));
	for (const entry of entries) {
		const abs = resolve(dirPath, entry.name);
		if (entry.isDirectory()) {
			await walkFiles(abs, out);
			continue;
		}
		if (entry.isFile()) {
			out.push(abs);
		}
	}
}
async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}
