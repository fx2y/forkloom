import { normalizeMarkdown } from "./normalize";
import { buildChunkId } from "./ids";
import type { Bbox, UpsertBlockInput, UpsertChunkInput, UpsertSpanInput } from "./ports";

export const MAX_CHARS = 6000;
export const SOFT_CHARS = 5000;
export const ATOMIC_KINDS = new Set(["table", "formula"]);

type PendingChunk = {
	page: number;
	blocks: UpsertBlockInput[];
	plainChars: number;
};

type ChunkDraft = {
	chunk: UpsertChunkInput;
	spans: UpsertSpanInput[];
	headingLevel: number | null;
};

function toLowerKind(kind: string): string {
	return kind.trim().toLowerCase();
}

function isAtomicKind(kind: string): boolean {
	return ATOMIC_KINDS.has(toLowerKind(kind));
}

function headingLevel(kind: string): number | null {
	const match = /^h([1-6])$/i.exec(kind.trim());
	if (!match) {
		return null;
	}
	return Number(match[1]);
}

function stableSortBlocks(blocks: UpsertBlockInput[]): UpsertBlockInput[] {
	return [...blocks].sort((a, b) => {
		if (a.page !== b.page) {
			return a.page - b.page;
		}
		return a.blockPath.localeCompare(b.blockPath);
	});
}

function unionBbox(blocks: UpsertBlockInput[]): Bbox | null {
	let x1 = Number.POSITIVE_INFINITY;
	let y1 = Number.POSITIVE_INFINITY;
	let x2 = Number.NEGATIVE_INFINITY;
	let y2 = Number.NEGATIVE_INFINITY;
	let has = false;
	for (const block of blocks) {
		if (!block.bbox) {
			continue;
		}
		const [bx1, by1, bx2, by2] = block.bbox;
		x1 = Math.min(x1, bx1);
		y1 = Math.min(y1, by1);
		x2 = Math.max(x2, bx2);
		y2 = Math.max(y2, by2);
		has = true;
	}
	if (!has) {
		return null;
	}
	return [x1, y1, x2, y2];
}

function buildChunkKind(blocks: UpsertBlockInput[]): string {
	const first = toLowerKind(blocks[0]?.kind ?? "mixed");
	return blocks.every((block) => toLowerKind(block.kind) === first)
		? first
		: "mixed";
}

function buildSpanRows(input: {
	docSha: string;
	parseId: string;
	chunkId: string;
	md: string;
	blocks: UpsertBlockInput[];
}): UpsertSpanInput[] {
	const spans: UpsertSpanInput[] = [];
	let offset = 0;
	for (const [i, block] of input.blocks.entries()) {
		const segment = block.textMd;
		const charStart = block.bbox ? null : offset;
		const charEnd = block.bbox ? null : offset + segment.length;
		spans.push({
			docSha: input.docSha,
			parseId: input.parseId,
			page: block.page,
			bbox: block.bbox,
			charStart,
			charEnd,
			blockPath: block.blockPath,
			chunkId: input.chunkId,
		});
		offset += segment.length;
		if (i < input.blocks.length - 1) {
			offset += 2;
		}
	}
	return spans;
}

function flushChunk(input: {
	docSha: string;
	parseId: string;
	pending: PendingChunk;
}): ChunkDraft {
	const first = input.pending.blocks[0];
	if (!first) {
		throw new Error("chunk flush requires at least one block");
	}
	const mdBody = input.pending.blocks.map((block) => block.textMd).join("\n\n");
	const plain = input.pending.blocks.map((block) => block.textPlain).join("\n");
	const md = normalizeMarkdown(mdBody);
	const chunkId = buildChunkId({
		parseId: input.parseId,
		page: input.pending.page,
		blockPath: first.blockPath,
		normMd: md,
	});
	const kind = buildChunkKind(input.pending.blocks);
	const spans = buildSpanRows({
		docSha: input.docSha,
		parseId: input.parseId,
		chunkId,
		md,
		blocks: input.pending.blocks,
	});
	const payload = {
		blockPaths: input.pending.blocks.map((block) => block.blockPath),
		kinds: input.pending.blocks.map((block) => block.kind),
		sameTable: kind === "table",
	};
	return {
		chunk: {
			chunkId,
			parseId: input.parseId,
			page: input.pending.page,
			kind,
			md,
			plain,
			payload,
			bboxUnion: unionBbox(input.pending.blocks),
			tokenEstimate: Math.max(1, Math.ceil(plain.length / 4)),
			prevChunkId: null,
			nextChunkId: null,
			parentChunkId: null,
		},
		spans,
		headingLevel: headingLevel(first.kind),
	};
}

function assignNeighborsAndParents(drafts: ChunkDraft[]): ChunkDraft[] {
	const byHeadingLevel = new Map<number, string>();
	let lastTableChunkId: string | null = null;
	for (const [i, current] of drafts.entries()) {
		const prev = i > 0 ? drafts[i - 1] : undefined;
		const next = drafts[i + 1];
		current.chunk.prevChunkId = prev?.chunk.chunkId ?? null;
		current.chunk.nextChunkId = next?.chunk.chunkId ?? null;

		if (current.headingLevel != null) {
			let parent: string | null = null;
			for (let level = current.headingLevel - 1; level >= 1; level -= 1) {
				const candidate = byHeadingLevel.get(level);
				if (candidate) {
					parent = candidate;
					break;
				}
			}
			current.chunk.parentChunkId = parent;
			byHeadingLevel.set(current.headingLevel, current.chunk.chunkId);
			for (let level = current.headingLevel + 1; level <= 6; level += 1) {
				byHeadingLevel.delete(level);
			}
		} else {
			const parent =
				byHeadingLevel.get(6) ??
				byHeadingLevel.get(5) ??
				byHeadingLevel.get(4) ??
				byHeadingLevel.get(3) ??
				byHeadingLevel.get(2) ??
				byHeadingLevel.get(1) ??
				null;
			current.chunk.parentChunkId = parent;
		}

		if (current.chunk.kind === "table") {
			(current.chunk.payload as { same_table_prev?: string | null }).same_table_prev =
				lastTableChunkId;
			lastTableChunkId = current.chunk.chunkId;
		}
	}
	return drafts;
}

export function toChunks(input: {
	docSha: string;
	parseId: string;
	blocks: UpsertBlockInput[];
	maxChars?: number | undefined;
	softChars?: number | undefined;
}): { chunks: UpsertChunkInput[]; spans: UpsertSpanInput[] } {
	const maxChars = input.maxChars ?? MAX_CHARS;
	const softChars = input.softChars ?? SOFT_CHARS;
	if (softChars > maxChars) {
		throw new Error("softChars must be <= maxChars");
	}

	const blocks = stableSortBlocks(input.blocks);
	const drafts: ChunkDraft[] = [];
	let pending: PendingChunk | null = null;

	const flush = (): void => {
		if (!pending || pending.blocks.length === 0) {
			return;
		}
		drafts.push(
			flushChunk({
				docSha: input.docSha,
				parseId: input.parseId,
				pending,
			}),
		);
		pending = null;
	};

	for (const block of blocks) {
		const nextChars = block.textPlain.length;
		if (!pending || pending.page !== block.page) {
			flush();
			pending = {
				page: block.page,
				blocks: [],
				plainChars: 0,
			};
		}
		const nextHeadingLevel = headingLevel(block.kind);
		const lastPendingBlock = pending.blocks[pending.blocks.length - 1];
		const lastIsAtomic = lastPendingBlock
			? isAtomicKind(lastPendingBlock.kind)
			: false;
		const atomic = isAtomicKind(block.kind);
		const overMax = pending.plainChars + nextChars > maxChars;
		const overSoft = pending.plainChars + nextChars > softChars;
		const semanticBoundary =
			pending.blocks.length > 0 &&
			(nextHeadingLevel != null ||
				(atomic && !lastIsAtomic) ||
				(!atomic && lastIsAtomic));
		if (
			pending.blocks.length > 0 &&
			(overMax || (overSoft && !atomic) || semanticBoundary)
		) {
			flush();
			pending = {
				page: block.page,
				blocks: [],
				plainChars: 0,
			};
		}
		pending.blocks.push(block);
		pending.plainChars += nextChars;
	}
	flush();

	assignNeighborsAndParents(drafts);
	return {
		chunks: drafts.map((draft) => draft.chunk),
		spans: drafts.flatMap((draft) => draft.spans),
	};
}
