import type { SpanRef } from "@forkloom/contracts";

export type DocStatus = "queued" | "processing" | "done" | "failed";
export type ParseStatus =
	| "queued"
	| "ocr_running"
	| "ocr_done"
	| "norm_done"
	| "indexed"
	| "indexing"
	| "done"
	| "failed";

export type Bbox = [number, number, number, number];

export type DocModel = {
	docSha: string;
	mime: string;
	bytes: number;
	rawArtifactSha: string | null;
	status: DocStatus;
	createdAt: string;
	updatedAt: string;
};

export type ParseModel = {
	parseId: string;
	docSha: string;
	parser: string;
	parserVersion: string;
	cfgHash: string;
	normVersion: string;
	mdArtifactSha: string | null;
	jsonArtifactSha: string | null;
	stats: Record<string, unknown>;
	status: ParseStatus;
	createdAt: string;
	updatedAt: string;
};

export type PageModel = {
	parseId: string;
	page: number;
	width: number | null;
	height: number | null;
	imageArtifactSha: string | null;
	mdArtifactSha: string | null;
	jsonArtifactSha: string | null;
	status: ParseStatus;
};

export type BlockModel = {
	parseId: string;
	page: number;
	blockPath: string;
	kind: string;
	bbox: Bbox | null;
	textMd: string;
	textPlain: string;
	payload: Record<string, unknown>;
	parentPath: string | null;
};

export type ChunkModel = {
	chunkId: string;
	parseId: string;
	page: number;
	kind: string;
	md: string;
	plain: string;
	payload: Record<string, unknown>;
	bboxUnion: Bbox | null;
	tokenEstimate: number;
	prevChunkId: string | null;
	nextChunkId: string | null;
	parentChunkId: string | null;
	createdAt: string;
	updatedAt: string;
};

export type SpanModel = SpanRef;

export type OcrUsageModel = {
	parseId: string;
	vendor: string;
	model: string;
	inputPages: number;
	inputBytes: number;
	outputTokens: number;
	costMicros: number;
	payload: Record<string, unknown>;
	createdAt: string;
	updatedAt: string;
};

export type ParsePayloadModel = {
	doc: DocModel;
	parse: ParseModel;
	usage: OcrUsageModel | null;
};

export type ChunkSearchModel = {
	chunkId: string;
	embedding: number[] | null;
};

export type UpsertDocInput = Omit<DocModel, "createdAt" | "updatedAt"> & {
	createdAt?: string | undefined;
	updatedAt?: string | undefined;
};

export type UpsertParseInput = Omit<ParseModel, "createdAt" | "updatedAt"> & {
	createdAt?: string | undefined;
	updatedAt?: string | undefined;
};

export type UpsertPageInput = PageModel;
export type UpsertBlockInput = BlockModel;
export type UpsertChunkInput = Omit<ChunkModel, "createdAt" | "updatedAt"> & {
	createdAt?: string | undefined;
	updatedAt?: string | undefined;
};
export type UpsertSpanInput = SpanModel;
export type UpsertOcrUsageInput = Omit<
	OcrUsageModel,
	"createdAt" | "updatedAt"
> & {
	createdAt?: string | undefined;
	updatedAt?: string | undefined;
};
export type UpsertChunkSearchInput = ChunkSearchModel;

export type AliasArtifactInput = {
	alias: string;
	sha256: string;
};

export type RecordParseLedgerInput = {
	doc: UpsertDocInput;
	parse: UpsertParseInput;
	aliases: AliasArtifactInput[];
	pages: UpsertPageInput[];
	blocks: UpsertBlockInput[];
	chunks: UpsertChunkInput[];
	spans: UpsertSpanInput[];
	usage?: UpsertOcrUsageInput | undefined;
	search: UpsertChunkSearchInput[];
};

export interface DocRepo {
	getDoc(docSha: string): Promise<DocModel | null>;
	getParse(parseId: string): Promise<ParseModel | null>;
	getParsePayload(parseId: string): Promise<ParsePayloadModel | null>;
	upsertDoc(input: UpsertDocInput): Promise<DocModel>;
	upsertParse(input: UpsertParseInput): Promise<ParseModel>;
	aliasArtifact(input: AliasArtifactInput): Promise<void>;
	resolveAlias(alias: string): Promise<string | null>;
	recordParseLedger(input: RecordParseLedgerInput): Promise<void>;
}
