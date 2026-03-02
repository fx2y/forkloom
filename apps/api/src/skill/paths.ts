import { lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";

const MARKDOWN_LINK_PATTERN = /\[[^\]]*]\(([^)]+)\)/g;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+\-.]*:/i;

export function resolveSkillPath(skillDir: string, relPath: string): string {
	const root = resolve(skillDir);
	const rootReal = resolveExistingRealPath(root);
	const rel = relPath.trim();
	if (rel.length === 0) {
		throw new Error("skill relative path is required");
	}
	const candidate = resolve(root, rel);
	if (candidate === root || !isPathWithin(root, candidate)) {
		throw new Error(`skill path escape: ${relPath}`);
	}
	const nearestExisting = findNearestExistingAncestor(candidate);
	const nearestReal = realpathSync(nearestExisting);
	if (!isPathWithin(rootReal, nearestReal)) {
		throw new Error(`skill path escape via symlink: ${relPath}`);
	}
	if (pathExists(candidate)) {
		const candidateStat = lstatSync(candidate);
		if (candidateStat.isSymbolicLink()) {
			const candidateReal = realpathSync(candidate);
			if (!isPathWithin(rootReal, candidateReal)) {
				throw new Error(`skill path symlink points outside root: ${relPath}`);
			}
		}
	}
	return candidate;
}

export function toSkillRelativePath(
	skillDir: string,
	maybeRelativePath: string,
): string | null {
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

export function isSkillLazyResourcePath(path: string): boolean {
	return path.startsWith("references/") || path.startsWith("assets/");
}

export function listSkillLinkedPaths(
	skillBody: string,
	skillDir: string,
): string[] {
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

export function listSkillScriptLinks(
	skillBody: string,
	skillDir: string,
): string[] {
	return listSkillLinkedPaths(skillBody, skillDir).filter((path) =>
		path.startsWith("scripts/"),
	);
}

export function dedupeSorted(values: string[]): string[] {
	const uniq = [...new Set(values.filter((value) => value.length > 0))];
	uniq.sort((left, right) => left.localeCompare(right));
	return uniq;
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

function isPathWithin(root: string, candidate: string): boolean {
	return candidate === root || candidate.startsWith(`${root}${sep}`);
}

function pathExists(path: string): boolean {
	try {
		statSync(path);
		return true;
	} catch {
		return false;
	}
}

function findNearestExistingAncestor(path: string): string {
	let current = path;
	while (!pathExists(current)) {
		const parent = dirname(current);
		if (parent === current) {
			throw new Error(`path has no existing ancestor: ${path}`);
		}
		current = parent;
	}
	return current;
}

function resolveExistingRealPath(path: string): string {
	if (!pathExists(path)) {
		throw new Error(`skill root not found: ${path}`);
	}
	return realpathSync(path);
}
