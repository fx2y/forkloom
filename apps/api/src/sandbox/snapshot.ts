import type { SnapshotRule } from "./ports";

export type WorkspaceFileEntry = {
	path: string;
	bytes: number;
	sha256: string;
};

const WORKSPACE_CACHE_SEGMENTS = new Set([
	".cache",
	".tmp",
	".venv",
	"node_modules",
	"tmp",
]);

export const WORKSPACE_SNAPSHOT_RULE: SnapshotRule = {
	include: ["."],
	exclude: Array.from(WORKSPACE_CACHE_SEGMENTS),
};

function splitPath(path: string): string[] {
	return path
		.split("/")
		.map((part) => part.trim())
		.filter((part) => part.length > 0 && part !== ".");
}

export function isDurableWorkspacePath(path: string): boolean {
	for (const part of splitPath(path)) {
		if (WORKSPACE_CACHE_SEGMENTS.has(part)) {
			return false;
		}
	}
	return true;
}

export function filterDurableWorkspaceEntries<T extends { path: string }>(
	entries: T[],
): T[] {
	return entries.filter((entry) => isDurableWorkspacePath(entry.path));
}

export function buildWorkspaceManifest(entries: WorkspaceFileEntry[]): {
	version: 1;
	entries: WorkspaceFileEntry[];
} {
	return {
		version: 1,
		entries: filterDurableWorkspaceEntries(entries).sort((left, right) =>
			left.path.localeCompare(right.path),
		),
	};
}
