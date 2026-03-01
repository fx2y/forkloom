import { buildDeterministicEmbedding } from "./search";
import { normalizeMarkdown } from "./normalize";
import { toChunks } from "./chunker";
import type {
	Bbox,
	UpsertBlockInput,
	UpsertChunkSearchInput,
	UpsertPageInput,
} from "./ports";

type LayoutEntry = {
	index: number;
	label: string;
	bbox2d: [number, number, number, number];
	content: string;
	width: number;
	height: number;
};

function canonicalBbox(entry: LayoutEntry): Bbox | null {
	const [x1, y1, x2, y2] = entry.bbox2d;
	if (![x1, y1, x2, y2].every((value) => Number.isFinite(value))) {
		return null;
	}
	const usePixels =
		entry.width > 1 &&
		entry.height > 1 &&
		x2 <= 1 &&
		y2 <= 1 &&
		x1 >= 0 &&
		y1 >= 0;
	const raw = usePixels
		? [x1 * entry.width, y1 * entry.height, x2 * entry.width, y2 * entry.height]
		: [x1, y1, x2, y2];
	return raw.map((value) => Number(value.toFixed(2))) as Bbox;
}

function headingLevel(kind: string): number | null {
	const match = /^h([1-6])$/i.exec(kind.trim());
	if (!match) {
		return null;
	}
	return Number(match[1]);
}

function normalizeBlockText(content: string): { textMd: string; textPlain: string } {
	const textMd = normalizeMarkdown(content).trimEnd();
	const textPlain = textMd.replace(/\s+/g, " ").trim();
	return {
		textMd,
		textPlain,
	};
}

export function toBlocks(input: {
	parseId: string;
	layoutDetails: LayoutEntry[][];
}): { pages: UpsertPageInput[]; blocks: UpsertBlockInput[] } {
	const pages: UpsertPageInput[] = [];
	const blocks: UpsertBlockInput[] = [];
	for (let pageIndex = 0; pageIndex < input.layoutDetails.length; pageIndex += 1) {
		const page = input.layoutDetails[pageIndex] ?? [];
		const pageNo = pageIndex + 1;
		const ordered = [...page].sort((a, b) => {
			if (a.index !== b.index) {
				return a.index - b.index;
			}
			return a.label.localeCompare(b.label);
		});
		const width =
			ordered.find((entry) => entry.width > 0)?.width ??
			null;
		const height =
			ordered.find((entry) => entry.height > 0)?.height ??
			null;
		pages.push({
			parseId: input.parseId,
			page: pageNo,
			width,
			height,
			imageArtifactSha: null,
			mdArtifactSha: null,
			jsonArtifactSha: null,
			status: "indexed",
		});

		const headingStack = new Map<number, string>();
			for (const [i, entry] of ordered.entries()) {
				const blockPath = `${pageNo}.${String(i + 1).padStart(6, "0")}`;
			const kind = entry.label.trim() || "P";
			const level = headingLevel(kind);
			let parentPath: string | null = null;
			if (level != null) {
				for (let l = level - 1; l >= 1; l -= 1) {
					const candidate = headingStack.get(l);
					if (candidate) {
						parentPath = candidate;
						break;
					}
				}
				headingStack.set(level, blockPath);
				for (let l = level + 1; l <= 6; l += 1) {
					headingStack.delete(l);
				}
			} else {
				parentPath =
					headingStack.get(6) ??
					headingStack.get(5) ??
					headingStack.get(4) ??
					headingStack.get(3) ??
					headingStack.get(2) ??
					headingStack.get(1) ??
					null;
			}
			const text = normalizeBlockText(entry.content);
			blocks.push({
				parseId: input.parseId,
				page: pageNo,
				blockPath,
				kind,
				bbox: canonicalBbox(entry),
				textMd: text.textMd,
				textPlain: text.textPlain,
				payload: {
					index: entry.index,
					label: entry.label,
					bbox_2d: entry.bbox2d,
					width: entry.width,
					height: entry.height,
				},
				parentPath,
			});
		}
	}
	return { pages, blocks };
}

export function buildDocPipeline(input: {
	docSha: string;
	parseId: string;
	layoutDetails: LayoutEntry[][];
}): {
	pages: UpsertPageInput[];
	blocks: UpsertBlockInput[];
	chunks: ReturnType<typeof toChunks>["chunks"];
	spans: ReturnType<typeof toChunks>["spans"];
	search: UpsertChunkSearchInput[];
} {
	const blockRows = toBlocks({
		parseId: input.parseId,
		layoutDetails: input.layoutDetails,
	});
	const chunkRows = toChunks({
		docSha: input.docSha,
		parseId: input.parseId,
		blocks: blockRows.blocks,
	});
	const search: UpsertChunkSearchInput[] = chunkRows.chunks.map((chunk) => ({
		chunkId: chunk.chunkId,
		embedding: buildDeterministicEmbedding(chunk.plain),
	}));
	return {
		pages: blockRows.pages,
		blocks: blockRows.blocks,
		chunks: chunkRows.chunks,
		spans: chunkRows.spans,
		search,
	};
}
