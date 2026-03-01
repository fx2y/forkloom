type SessionEntryRecord = {
	type: string;
	id: string;
	parentId?: string | undefined;
	[key: string]: unknown;
};

export type SessionIndexSummary = {
	entryCount: number;
	rootId?: string | undefined;
	leafId?: string | undefined;
	summaryEntryCount: number;
	compactionEntryCount: number;
	branchSummaryEntryCount: number;
	sessionEntryIds: string[];
	leafPathIds: string[];
};

export type SessionTreeIndex = SessionIndexSummary & {
	entries: SessionEntryRecord[];
	byId: Map<string, SessionEntryRecord>;
	kids: Map<string, string[]>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asSessionEntry(value: unknown, lineNo: number): SessionEntryRecord {
	if (!isRecord(value)) {
		throw new Error(`session index: line ${lineNo} is not an object`);
	}
	const id = value.id;
	const type = value.type;
	const parentId = value.parentId;
	if (typeof id !== "string" || id.length === 0) {
		throw new Error(`session index: line ${lineNo} has invalid id`);
	}
	if (typeof type !== "string" || type.length === 0) {
		throw new Error(`session index: line ${lineNo} has invalid type`);
	}
	if (
		parentId !== undefined &&
		(typeof parentId !== "string" || parentId.length === 0)
	) {
		throw new Error(`session index: line ${lineNo} has invalid parentId`);
	}
	return {
		...(value as Record<string, unknown>),
		type,
		id,
		parentId: parentId as string | undefined,
	};
}

function isSummaryType(type: string): boolean {
	return type === "compaction" || type === "branch_summary";
}

function findLeafId(entries: SessionEntryRecord[]): string | undefined {
	if (entries.length === 0) {
		return undefined;
	}
	const parentIds = new Set<string>();
	for (const entry of entries) {
		if (entry.parentId) {
			parentIds.add(entry.parentId);
		}
	}
	let candidate: string | undefined;
	for (const entry of entries) {
		if (!parentIds.has(entry.id)) {
			candidate = entry.id;
		}
	}
	return candidate ?? entries[entries.length - 1]?.id;
}

function buildLeafPathIds(
	byId: Map<string, SessionEntryRecord>,
	leafId: string | undefined,
): string[] {
	if (!leafId) {
		return [];
	}
	const reversed: string[] = [];
	const seen = new Set<string>();
	let cursor: string | undefined = leafId;
	while (cursor) {
		if (seen.has(cursor)) {
			throw new Error(`session index: cycle detected at id=${cursor}`);
		}
		seen.add(cursor);
		reversed.push(cursor);
		const entry = byId.get(cursor);
		if (!entry) {
			throw new Error(`session index: missing entry for id=${cursor}`);
		}
		cursor = entry.parentId;
	}
	return reversed.reverse();
}

export function assertToolCallResultAdjacency(
	entries: SessionEntryRecord[],
): void {
	for (let i = 0; i < entries.length; i += 1) {
		const current = entries[i];
		if (!current || current.type !== "tool_call") {
			continue;
		}
		let nextIndex = i + 1;
		while (nextIndex < entries.length) {
			const candidate = entries[nextIndex];
			if (!candidate) {
				break;
			}
			if (!isSummaryType(candidate.type)) {
				if (candidate.type !== "tool_result") {
					throw new Error(
						`session index: tool_call adjacency broken id=${current.id} next_type=${candidate.type}`,
					);
				}
				break;
			}
			nextIndex += 1;
		}
		if (nextIndex >= entries.length) {
			throw new Error(
				`session index: tool_call without tool_result id=${current.id}`,
			);
		}
	}
}

export function parseSessionJsonl(content: string): SessionTreeIndex {
	const rawLines = content.split(/\r?\n/);
	const lines = rawLines.filter((line) => line.trim().length > 0);
	const entries: SessionEntryRecord[] = [];
	const byId = new Map<string, SessionEntryRecord>();
	const kids = new Map<string, string[]>();
	let summaryEntryCount = 0;
	let compactionEntryCount = 0;
	let branchSummaryEntryCount = 0;

	for (let index = 0; index < lines.length; index += 1) {
		const line = lines[index];
		if (!line) {
			continue;
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch (error) {
			throw new Error(
				`session index: invalid JSON on line ${index + 1}: ${(error as Error).message}`,
			);
		}
		const entry = asSessionEntry(parsed, index + 1);
		if (byId.has(entry.id)) {
			throw new Error(`session index: duplicate entry id=${entry.id}`);
		}
		entries.push(entry);
		byId.set(entry.id, entry);
		const parent = entry.parentId ?? "ROOT";
		const children = kids.get(parent) ?? [];
		children.push(entry.id);
		kids.set(parent, children);
		if (isSummaryType(entry.type)) {
			summaryEntryCount += 1;
			if (entry.type === "compaction") {
				compactionEntryCount += 1;
			}
			if (entry.type === "branch_summary") {
				branchSummaryEntryCount += 1;
			}
		}
	}

	for (const entry of entries) {
		if (entry.parentId && !byId.has(entry.parentId)) {
			throw new Error(
				`session index: dangling parent id=${entry.id} parentId=${entry.parentId}`,
			);
		}
	}

	const rootId = entries.find((entry) => !entry.parentId)?.id;
	const leafId = findLeafId(entries);
	const leafPathIds = buildLeafPathIds(byId, leafId);
	const sessionEntryIds = entries.map((entry) => entry.id);

	return {
		entries,
		byId,
		kids,
		entryCount: entries.length,
		rootId,
		leafId,
		summaryEntryCount,
		compactionEntryCount,
		branchSummaryEntryCount,
		sessionEntryIds,
		leafPathIds,
	};
}
