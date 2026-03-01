export type DocKind = "pdf" | "image";

export type DocRejectCode =
	| "unsupported_mime"
	| "pdf_bytes_limit"
	| "pdf_pages_limit"
	| "image_bytes_limit";

export type DocClassifyInput = {
	mime: string;
	bytes: number;
	body: Uint8Array;
	pdfMaxBytes: number;
	pdfMaxPages: number;
	imageMaxBytes: number;
};

export type DocClassifyAccepted =
	| {
			accepted: true;
			kind: "pdf";
			bytes: number;
			pages: number;
	  }
	| {
			accepted: true;
			kind: "image";
			bytes: number;
	  };

export type DocClassifyRejected = {
	accepted: false;
	kind: DocKind | "unknown";
	code: DocRejectCode;
	actual: number | string;
	limit: number | null;
	pages: number | null;
};

export type DocClassifyResult = DocClassifyAccepted | DocClassifyRejected;

function isImageMime(mime: string): boolean {
	return mime.startsWith("image/");
}

function ensurePositiveLimit(value: number, label: string): number {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`invalid ${label}: expected positive integer`);
	}
	return value;
}

export function countPdfPages(body: Uint8Array): number {
	const text = Buffer.from(body).toString("latin1");
	const matches = text.match(/\/Type\s*\/Page\b/g);
	return Math.max(1, matches?.length ?? 0);
}

export function classifyDoc(input: DocClassifyInput): DocClassifyResult {
	const pdfMaxBytes = ensurePositiveLimit(input.pdfMaxBytes, "pdfMaxBytes");
	const pdfMaxPages = ensurePositiveLimit(input.pdfMaxPages, "pdfMaxPages");
	const imageMaxBytes = ensurePositiveLimit(
		input.imageMaxBytes,
		"imageMaxBytes",
	);

	if (input.mime === "application/pdf") {
		if (input.bytes > pdfMaxBytes) {
			return {
				accepted: false,
				kind: "pdf",
				code: "pdf_bytes_limit",
				actual: input.bytes,
				limit: pdfMaxBytes,
				pages: null,
			};
		}
		const pages = countPdfPages(input.body);
		if (pages > pdfMaxPages) {
			return {
				accepted: false,
				kind: "pdf",
				code: "pdf_pages_limit",
				actual: pages,
				limit: pdfMaxPages,
				pages,
			};
		}
		return {
			accepted: true,
			kind: "pdf",
			bytes: input.bytes,
			pages,
		};
	}

	if (isImageMime(input.mime)) {
		if (input.bytes > imageMaxBytes) {
			return {
				accepted: false,
				kind: "image",
				code: "image_bytes_limit",
				actual: input.bytes,
				limit: imageMaxBytes,
				pages: null,
			};
		}
		return {
			accepted: true,
			kind: "image",
			bytes: input.bytes,
		};
	}

	return {
		accepted: false,
		kind: "unknown",
		code: "unsupported_mime",
		actual: input.mime,
		limit: null,
		pages: null,
	};
}
