import { basename } from "node:path";
import type { ThemeCandidate, ThemeResolveInput } from "./types";

const SOURCE_PRECEDENCE: Record<ThemeCandidate["source"], number> = {
	builtin: 0,
	global: 1,
	project: 2,
	package: 3,
	settings: 4,
	cli: 5,
};

function toThemeNameFromPath(path: string): string {
	const file = basename(path);
	return file.endsWith(".json") ? file.slice(0, -5) : file;
}

function normalizeCandidate(candidate: ThemeCandidate): ThemeCandidate {
	return {
		...candidate,
		name:
			candidate.name.trim().length > 0
				? candidate.name.trim()
				: toThemeNameFromPath(candidate.path),
	};
}

export function sortThemeCandidates(
	candidates: ThemeCandidate[],
): ThemeCandidate[] {
	return [...candidates].map(normalizeCandidate).sort((left, right) => {
		const sourceCmp =
			SOURCE_PRECEDENCE[left.source] - SOURCE_PRECEDENCE[right.source];
		if (sourceCmp !== 0) {
			return sourceCmp;
		}
		const nameCmp = left.name.localeCompare(right.name);
		if (nameCmp !== 0) {
			return nameCmp;
		}
		return left.path.localeCompare(right.path);
	});
}

export function resolveActiveTheme(
	input: ThemeResolveInput,
): ThemeCandidate | null {
	if (input.disableThemes) {
		return null;
	}
	const ordered = sortThemeCandidates(input.candidates);
	if (ordered.length === 0) {
		return null;
	}
	const selectedName =
		input.cliTheme?.trim() ||
		input.settingsTheme?.trim() ||
		ordered[ordered.length - 1]?.name;
	if (!selectedName) {
		return null;
	}
	const exact = ordered.find((candidate) => candidate.name === selectedName);
	if (exact) {
		return exact;
	}
	return ordered[ordered.length - 1] ?? null;
}
