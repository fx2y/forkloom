import { readdir, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";

export type SkillPreviewSnapshot = {
	scripts: string[];
	touchedPaths: string[];
};

const MARKDOWN_LINK_PATTERN = /\[[^\]]*]\(([^)]+)\)/g;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+\-.]*:/i;

export async function buildSkillPreviewSnapshot(input: {
	skillPath: string;
	skillBody: string;
}): Promise<SkillPreviewSnapshot> {
	const skillDir = dirname(input.skillPath);
	const scripts = await listScriptFiles(skillDir);
	const linkedPaths = listLinkedPaths(input.skillBody, skillDir);
	const touchedPaths = dedupeSorted([...linkedPaths, ...scripts]);
	return {
		scripts,
		touchedPaths,
	};
}

function listLinkedPaths(skillBody: string, skillDir: string): string[] {
	const linked: string[] = [];
	for (const match of skillBody.matchAll(MARKDOWN_LINK_PATTERN)) {
		const target = normalizeLinkTarget(match[1] ?? "");
		if (!target || target.startsWith("/") || target.startsWith("#")) {
			continue;
		}
		if (target.startsWith("//") || URL_SCHEME_PATTERN.test(target)) {
			continue;
		}
		const rel = toSkillRelativePath(skillDir, target);
		if (!rel) {
			continue;
		}
		linked.push(rel);
	}
	return dedupeSorted(linked);
}

function normalizeLinkTarget(target: string): string {
	const trimmed = target.trim();
	if (trimmed.length === 0) {
		return "";
	}
	const noBrackets = trimmed.replace(/^<|>$/g, "");
	const noTitle = noBrackets.split(/\s+/)[0] ?? "";
	return noTitle.split(/[?#]/)[0] ?? "";
}

async function listScriptFiles(skillDir: string): Promise<string[]> {
	const scriptDir = resolve(skillDir, "scripts");
	if (!(await isDirectory(scriptDir))) {
		return [];
	}
	const files: string[] = [];
	await walkFiles(scriptDir, files);
	return dedupeSorted(files.map((path) => toSkillRelativePath(skillDir, path) ?? ""));
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

function toSkillRelativePath(skillDir: string, maybeRelativePath: string): string | null {
	const root = resolve(skillDir);
	const candidate = resolve(root, maybeRelativePath);
	if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) {
		return null;
	}
	const rel = relative(root, candidate);
	if (rel.length === 0) {
		return null;
	}
	return rel.split(sep).join("/");
}

function dedupeSorted(values: string[]): string[] {
	const uniq = [...new Set(values.filter((value) => value.length > 0))];
	uniq.sort((left, right) => left.localeCompare(right));
	return uniq;
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}
