import { hashBytes, hashJSON, hashText, isSha256 } from "@forkloom/shared";
import type { Bbox, SpanModel } from "./ports";

export const DOC_PARSER = "glm-ocr";

export type ParseCfgHashInput = {
	endpoint: string;
	model: string;
	parserVersion: string;
	normVersion: string;
	pdfMaxBytes: number;
	pdfMaxPages: number;
	imageMaxBytes: number;
};

export type ParseIdInput = {
	docSha: string;
	parser: string;
	parserVersion: string;
	cfgHash: string;
	normVersion: string;
};

export type ChunkIdInput = {
	parseId: string;
	page: number;
	blockPath: string;
	normMd: string;
};

function requireSha(label: string, value: string): string {
	if (!isSha256(value)) {
		throw new Error(`invalid ${label}: expected sha256`);
	}
	return value;
}

function requirePositiveInt(label: string, value: number): number {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`invalid ${label}: expected positive integer`);
	}
	return value;
}

function bboxToken(bbox: Bbox | null): string {
	if (bbox == null) {
		return "";
	}
	return bbox.join(",");
}

export function buildDocSha(body: Uint8Array): string {
	return hashBytes(body);
}

export function buildParseCfgHash(input: ParseCfgHashInput): string {
	if (!input.endpoint) {
		throw new Error("invalid endpoint: empty");
	}
	if (!input.model) {
		throw new Error("invalid model: empty");
	}
	return hashJSON(input);
}

export function buildParseId(input: ParseIdInput): string {
	const docSha = requireSha("docSha", input.docSha);
	if (!input.parser) {
		throw new Error("invalid parser: empty");
	}
	if (!input.parserVersion) {
		throw new Error("invalid parserVersion: empty");
	}
	if (!input.normVersion) {
		throw new Error("invalid normVersion: empty");
	}
	const cfgHash = requireSha("cfgHash", input.cfgHash);
	return hashText(
		`${docSha}|${input.parser}|${input.parserVersion}|${cfgHash}|${input.normVersion}`,
	);
}

export function buildChunkId(input: ChunkIdInput): string {
	const parseId = requireSha("parseId", input.parseId);
	requirePositiveInt("page", input.page);
	if (!input.blockPath) {
		throw new Error("invalid blockPath: empty");
	}
	return hashText(
		`${parseId}|p${input.page}|${input.blockPath}|${input.normMd}`,
	);
}

export function buildSpanId(input: SpanModel): string {
	requirePositiveInt("page", input.page);
	if (!input.blockPath) {
		throw new Error("invalid blockPath: empty");
	}
	const bbox = bboxToken(input.bbox);
	const hasCharRange = input.charStart != null && input.charEnd != null;
	if (!bbox && !hasCharRange) {
		throw new Error("span id requires bbox or char range");
	}
	const range = hasCharRange ? `${input.charStart}:${input.charEnd}` : "";
	return `${input.chunkId}:${input.page}:${input.blockPath}:${bbox || range}`;
}
