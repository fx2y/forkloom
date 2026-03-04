import type { SearchScopeModel } from "./ports";

const SHA256_RE = /^[a-f0-9]{64}$/;
const EMBEDDING_DIMS = 1536;

export function parseSearchScope(scopeRaw: string): SearchScopeModel {
	const scope = scopeRaw.trim();
	if (!scope) {
		throw new Error("search scope is required");
	}
	if (scope === "org") {
		return { scope, docSha: null, parseId: null, overlay: "org" };
	}
	if (scope === "team" || scope === "ws") {
		return { scope, docSha: null, parseId: null, overlay: "ws" };
	}
	if (scope === "me" || scope === "member") {
		return { scope, docSha: null, parseId: null, overlay: "all" };
	}
	if (scope === "*" || scope === "all") {
		return { scope, docSha: null, parseId: null, overlay: "all" };
	}
	if (scope.startsWith("doc:")) {
		const docSha = scope.slice(4).trim();
		if (!SHA256_RE.test(docSha)) {
			throw new Error("invalid search scope doc sha");
		}
		return { scope, docSha, parseId: null, overlay: "all" };
	}
	if (scope.startsWith("parse:")) {
		const parseId = scope.slice(6).trim();
		if (!parseId) {
			throw new Error("invalid search scope parse id");
		}
		return { scope, docSha: null, parseId, overlay: "all" };
	}
	if (SHA256_RE.test(scope)) {
		return { scope, docSha: scope, parseId: null, overlay: "all" };
	}
	return { scope, docSha: null, parseId: scope, overlay: "all" };
}

export function buildDeterministicEmbedding(text: string): number[] {
	const vector = new Array<number>(EMBEDDING_DIMS).fill(0);
	for (let i = 0; i < text.length; i += 1) {
		const code = text.charCodeAt(i);
		const slot = i % EMBEDDING_DIMS;
		vector[slot] = (vector[slot] ?? 0) + ((code % 97) + 1) / 97;
	}
	let norm = 0;
	for (const value of vector) {
		norm += value * value;
	}
	const denom = Math.sqrt(norm) || 1;
	return vector.map((value) => Number((value / denom).toFixed(8)));
}

export function cosineScore(a: number[], b: number[]): number {
	const width = Math.min(a.length, b.length);
	if (width === 0) {
		return 0;
	}
	let dot = 0;
	let an = 0;
	let bn = 0;
	for (let i = 0; i < width; i += 1) {
		const av = a[i] ?? 0;
		const bv = b[i] ?? 0;
		dot += av * bv;
		an += av * av;
		bn += bv * bv;
	}
	if (an === 0 || bn === 0) {
		return 0;
	}
	return dot / (Math.sqrt(an) * Math.sqrt(bn));
}

export function toPgVectorLiteral(values: number[]): string {
	if (values.length === 0) {
		return "[]";
	}
	return `[${values.map((value) => Number(value.toFixed(8))).join(",")}]`;
}

export function toSnippet(text: string, maxChars = 220): string {
	const collapsed = text.replace(/\s+/g, " ").trim();
	if (collapsed.length <= maxChars) {
		return collapsed;
	}
	return `${collapsed.slice(0, maxChars - 1)}…`;
}
