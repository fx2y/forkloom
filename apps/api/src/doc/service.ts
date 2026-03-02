import type { RunDocResolve, RunDocSearch, SpanRef } from "@forkloom/contracts";
import type { DocRepo, RecordParseLedgerInput } from "./ports";
import {
	buildDeterministicEmbedding,
	cosineScore,
	parseSearchScope,
	toSnippet,
} from "./search";

export type DocServiceDeps = {
	repo: DocRepo;
};

export class DocService {
	constructor(private readonly deps: DocServiceDeps) {}

	async recordParseLedger(input: RecordParseLedgerInput): Promise<void> {
		await this.deps.repo.recordParseLedger(input);
	}

	async searchDocs(input: {
		query: string;
		scope: string;
		limit?: number | undefined;
	}): Promise<RunDocSearch> {
		const query = input.query.trim();
		if (!query) {
			throw new Error("search query is required");
		}
		const limit = input.limit ?? 20;
		if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
			throw new Error("search limit must be an integer in [1,100]");
		}
		const scope = parseSearchScope(input.scope);
		const searchInput = {
			query,
			scope,
			limit,
		};
		const queryEmbedding = buildDeterministicEmbedding(query);
		const [lexical, vectors] = await Promise.all([
			this.deps.repo.searchLexicalChunks(searchInput),
			this.deps.repo.listVectorChunks(searchInput, queryEmbedding),
		]);
		const scoreByChunk = new Map<
			string,
			{ score: number; snippet: string; chunkId: string }
		>();
		for (const hit of lexical) {
			scoreByChunk.set(hit.chunkId, {
				chunkId: hit.chunkId,
				score: hit.score,
				snippet: toSnippet(hit.plain || hit.md),
			});
		}
		for (const candidate of vectors) {
			const vectorScore =
				candidate.distance == null
					? cosineScore(queryEmbedding, candidate.embedding)
					: 1 / (1 + candidate.distance);
			const current = scoreByChunk.get(candidate.chunkId);
			const score = (current?.score ?? 0) + vectorScore;
			scoreByChunk.set(candidate.chunkId, {
				chunkId: candidate.chunkId,
				score,
				snippet: current?.snippet ?? toSnippet(candidate.plain || candidate.md),
			});
		}
		const ordered = [...scoreByChunk.values()]
			.sort((a, b) =>
				b.score === a.score
					? a.chunkId.localeCompare(b.chunkId)
					: b.score - a.score,
			)
			.slice(0, limit);
		const spans = await this.deps.repo.listChunkSpans(
			ordered.map((entry) => entry.chunkId),
		);
		const spansByChunk = new Map<string, SpanRef[]>();
		for (const span of spans) {
			const existing = spansByChunk.get(span.chunkId);
			if (existing) {
				existing.push(span);
			} else {
				spansByChunk.set(span.chunkId, [span]);
			}
		}
		return {
			query,
			scope: scope.scope,
			hits: ordered
				.map((entry) => ({
					chunkId: entry.chunkId,
					score: Number(entry.score.toFixed(8)),
					spans: spansByChunk.get(entry.chunkId) ?? [],
					snippet: entry.snippet,
				}))
				.filter((hit) => hit.spans.length > 0),
		};
	}

	async resolveSpan(span: SpanRef): Promise<RunDocResolve | null> {
		return this.deps.repo.resolveSpan(span);
	}

	async markParseDone(parseId: string, publishedAt: string): Promise<void> {
		await this.deps.repo.markParseDone({ parseId, publishedAt });
	}
}
