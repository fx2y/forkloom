import type { ParseStatus } from "./ports";

export type ParseStatusState =
	| "queued"
	| "ocr_running"
	| "ocr_done"
	| "norm_done"
	| "indexed"
	| "done"
	| "failed";

const TRANSITIONS: Record<ParseStatusState, readonly ParseStatusState[]> = {
	queued: ["ocr_running", "failed"],
	ocr_running: ["ocr_done", "failed"],
	ocr_done: ["norm_done", "indexed", "done", "failed"],
	norm_done: ["indexed", "done", "failed"],
	indexed: ["done", "failed"],
	done: [],
	failed: ["queued"],
};

// parse status is canonicalized so workflow logic does not branch on legacy spellings.
export function canonicalParseStatus(status: ParseStatus): ParseStatusState {
	switch (status) {
		case "indexing":
			return "indexed";
		default:
			return status;
	}
}

export function canTransitionParseStatus(
	from: ParseStatus,
	to: ParseStatusState,
): boolean {
	return TRANSITIONS[canonicalParseStatus(from)].includes(to);
}

export function transitionParseStatus(
	from: ParseStatus,
	to: ParseStatusState,
): ParseStatus {
	if (!canTransitionParseStatus(from, to)) {
		throw new Error(`invalid parse status transition: ${from} -> ${to}`);
	}
	return to;
}

const OCR_DONE_SET = new Set<ParseStatusState>([
	"ocr_done",
	"norm_done",
	"indexed",
	"done",
]);

export function isOcrDoneStatus(status: ParseStatus): boolean {
	return OCR_DONE_SET.has(canonicalParseStatus(status));
}
