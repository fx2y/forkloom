import { hashText } from "./artifact";
import { type JsonValue, canonicalizeValue } from "./canonicalize";

export type OcrSpan = {
	text: string;
	start: number;
	end: number;
	page?: number;
};

export type OcrRawResult = {
	markdown: string;
	json: JsonValue;
	spans: OcrSpan[];
};

export type OcrNormalizedResult = {
	markdown: string;
	json: JsonValue;
	spans: OcrSpan[];
	sha256: string;
};

function normalizeMarkdown(markdown: string): string {
	return markdown
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.join("\n")
		.trim();
}

function normalizeSpans(spans: OcrSpan[]): OcrSpan[] {
	return [...spans]
		.map((span) => ({
			...span,
			text: span.text.replace(/\s+/g, " ").trim(),
		}))
		.sort((a, b) => {
			if (a.page !== b.page) {
				return (a.page ?? 0) - (b.page ?? 0);
			}
			if (a.start !== b.start) {
				return a.start - b.start;
			}
			if (a.end !== b.end) {
				return a.end - b.end;
			}
			return a.text.localeCompare(b.text);
		});
}

export function normalizeOcrResult(raw: OcrRawResult): OcrNormalizedResult {
	const normalized = {
		markdown: normalizeMarkdown(raw.markdown),
		json: canonicalizeValue(raw.json),
		spans: normalizeSpans(raw.spans),
	};

	const payload = JSON.stringify(normalized);
	return {
		...normalized,
		sha256: hashText(payload),
	};
}
