import { isSha256 } from "@forkloom/shared";

function requireSha(label: string, value: string): string {
	if (!isSha256(value)) {
		throw new Error(`invalid ${label}: expected sha256`);
	}
	return value;
}

function requireNonEmpty(label: string, value: string): string {
	if (value.trim().length === 0) {
		throw new Error(`invalid ${label}: empty`);
	}
	return value;
}

export function buildRawAlias(docSha: string): string {
	return `raw/${requireSha("docSha", docSha)}`;
}

export function buildParseMdAlias(parseId: string): string {
	return `parse/${requireSha("parseId", parseId)}.md`;
}

export function buildParseJsonAlias(parseId: string): string {
	return `parse/${requireSha("parseId", parseId)}.json`;
}

export function buildChunkMdAlias(chunkId: string): string {
	return `chunks/${requireNonEmpty("chunkId", chunkId)}.md`;
}

export function buildChunkJsonAlias(chunkId: string): string {
	return `chunks/${requireNonEmpty("chunkId", chunkId)}.json`;
}
