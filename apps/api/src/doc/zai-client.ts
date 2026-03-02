type FetchLike = typeof fetch;

export type ZaiLayoutFile =
	| string
	| {
			kind: "url";
			value: string;
	  }
	| {
			kind: "data_url";
			value: string;
	  }
	| {
			kind: "bytes";
			value: Uint8Array;
			mime: string;
	  };

type LayoutElement = {
	index: number;
	label: string;
	bbox2d: [number, number, number, number];
	content: string;
	width: number;
	height: number;
};

export type ZaiLayoutResult = {
	markdown: string;
	layoutDetails: LayoutElement[][];
	pageCount: number;
	usage: {
		inputPages: number;
		outputTokens: number;
		costMicros: number;
		raw: Record<string, unknown>;
	};
	raw: Record<string, unknown>;
};

export type ZaiLayoutClientDeps = {
	endpoint: string;
	apiKey: string;
	model: string;
	retryLimit?: number | undefined;
	retryDelayMs?: number | undefined;
	fetchImpl?: FetchLike | undefined;
};

const RETRYABLE_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

function parseRecord(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value == null || Array.isArray(value)) {
		throw new Error(`invalid ${label}: expected object`);
	}
	return value as Record<string, unknown>;
}

function parseNumber(value: unknown, label: string): number {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		throw new Error(`invalid ${label}: expected finite number`);
	}
	return value;
}

function parseString(value: unknown, label: string): string {
	if (typeof value !== "string") {
		throw new Error(`invalid ${label}: expected string`);
	}
	return value;
}

function parseLayoutElement(
	value: unknown,
	pageIndex: number,
	itemIndex: number,
): LayoutElement {
	const entry = parseRecord(
		value,
		`layout_details[${pageIndex}][${itemIndex}]`,
	);
	const bboxRaw = entry.bbox_2d;
	if (!Array.isArray(bboxRaw) || bboxRaw.length !== 4) {
		throw new Error(
			`invalid layout_details[${pageIndex}][${itemIndex}].bbox_2d: expected [x1,y1,x2,y2]`,
		);
	}
	return {
		index: parseNumber(entry.index ?? itemIndex, "layout element index"),
		label: parseString(entry.label ?? "P", "layout element label"),
		bbox2d: [
			parseNumber(bboxRaw[0], "bbox_2d[0]"),
			parseNumber(bboxRaw[1], "bbox_2d[1]"),
			parseNumber(bboxRaw[2], "bbox_2d[2]"),
			parseNumber(bboxRaw[3], "bbox_2d[3]"),
		],
		content: parseString(entry.content ?? "", "layout element content"),
		width: parseNumber(entry.width ?? 0, "layout element width"),
		height: parseNumber(entry.height ?? 0, "layout element height"),
	};
}

function parseLayoutDetails(value: unknown): LayoutElement[][] {
	if (!Array.isArray(value)) {
		throw new Error("invalid layout_details: expected array");
	}
	return value.map((page, pageIndex) => {
		if (!Array.isArray(page)) {
			throw new Error(`invalid layout_details[${pageIndex}]: expected array`);
		}
		return page.map((item, itemIndex) =>
			parseLayoutElement(item, pageIndex, itemIndex),
		);
	});
}

function parseMarkdown(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (
		Array.isArray(value) &&
		value.every((entry) => typeof entry === "string")
	) {
		return value.join("\n\n");
	}
	throw new Error("invalid md_results: expected string or string[]");
}

function toDataUrl(input: { bytes: Uint8Array; mime: string }): string {
	if (!input.mime) {
		throw new Error("layout_parsing bytes input requires mime");
	}
	const encoded = Buffer.from(input.bytes).toString("base64");
	if (!encoded) {
		throw new Error("layout_parsing bytes input is empty");
	}
	return `data:${input.mime};base64,${encoded}`;
}

function resolveFileField(file: ZaiLayoutFile): string {
	if (typeof file === "string") {
		if (!file) {
			throw new Error("layout_parsing requires file input");
		}
		return file;
	}
	if (file.kind === "url" || file.kind === "data_url") {
		if (!file.value) {
			throw new Error("layout_parsing requires file input");
		}
		return file.value;
	}
	return toDataUrl({
		bytes: file.value,
		mime: file.mime,
	});
}

function readUsage(
	usage: Record<string, unknown> | null,
	pageCount: number,
): ZaiLayoutResult["usage"] {
	if (!usage) {
		return {
			inputPages: pageCount,
			outputTokens: 0,
			costMicros: 0,
			raw: {},
		};
	}
	const inputPagesRaw = usage.input_pages;
	const outputTokensRaw = usage.output_tokens ?? usage.total_tokens;
	const costMicrosRaw = usage.cost_micros ?? usage.estimated_cost_micros;
	return {
		inputPages:
			typeof inputPagesRaw === "number" && Number.isFinite(inputPagesRaw)
				? Math.max(0, Math.trunc(inputPagesRaw))
				: pageCount,
		outputTokens:
			typeof outputTokensRaw === "number" && Number.isFinite(outputTokensRaw)
				? Math.max(0, Math.trunc(outputTokensRaw))
				: 0,
		costMicros:
			typeof costMicrosRaw === "number" && Number.isFinite(costMicrosRaw)
				? Math.max(0, Math.trunc(costMicrosRaw))
				: 0,
		raw: usage,
	};
}

function waitMs(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseJsonText(text: string): Record<string, unknown> {
	try {
		return parseRecord(JSON.parse(text), "layout_parsing payload");
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "invalid JSON response";
		throw new Error(`layout_parsing decode failed: ${message}`);
	}
}

function shouldRetryStatus(status: number): boolean {
	return RETRYABLE_STATUS.has(status);
}

function pageCountFromPayload(
	dataInfo: Record<string, unknown> | null,
	layoutDetails: LayoutElement[][],
): number {
	const numPagesRaw = dataInfo?.num_pages;
	if (typeof numPagesRaw === "number" && Number.isFinite(numPagesRaw)) {
		return Math.max(1, Math.trunc(numPagesRaw));
	}
	return Math.max(1, layoutDetails.length);
}

export class ZaiLayoutClient {
	private readonly retryLimit: number;
	private readonly retryDelayMs: number;
	private readonly fetchImpl: FetchLike;

	constructor(private readonly deps: ZaiLayoutClientDeps) {
		if (!deps.endpoint) {
			throw new Error("invalid endpoint: empty");
		}
		if (!deps.apiKey) {
			throw new Error("invalid apiKey: empty");
		}
		if (!deps.model) {
			throw new Error("invalid model: empty");
		}
		this.retryLimit = deps.retryLimit ?? 3;
		this.retryDelayMs = deps.retryDelayMs ?? 250;
		this.fetchImpl = deps.fetchImpl ?? fetch;
	}

	async layoutParsing(file: ZaiLayoutFile): Promise<ZaiLayoutResult> {
		const fileField = resolveFileField(file);
		const requestBody = JSON.stringify({
			model: this.deps.model,
			file: fileField,
		});
		let lastError: Error | null = null;
		for (let attempt = 1; attempt <= this.retryLimit; attempt += 1) {
			try {
				const response = await this.fetchImpl(this.deps.endpoint, {
					method: "POST",
					headers: {
						Authorization: `Bearer ${this.deps.apiKey}`,
						"content-type": "application/json",
					},
					body: requestBody,
				});
				const responseText = await response.text();
				if (!response.ok) {
					if (shouldRetryStatus(response.status) && attempt < this.retryLimit) {
						await waitMs(this.retryDelayMs * attempt);
						continue;
					}
					throw new Error(
						`layout_parsing failed status=${response.status} body=${responseText.slice(0, 200)}`,
					);
				}

				const payload = parseJsonText(responseText);
				const layoutDetails = parseLayoutDetails(payload.layout_details);
				const markdown = parseMarkdown(payload.md_results ?? payload.markdown);
				const dataInfo =
					payload.data_info == null
						? null
						: parseRecord(payload.data_info, "data_info");
				const pageCount = pageCountFromPayload(dataInfo, layoutDetails);
				const usage =
					payload.usage == null ? null : parseRecord(payload.usage, "usage");
				return {
					markdown,
					layoutDetails,
					pageCount,
					usage: readUsage(usage, pageCount),
					raw: payload,
				};
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				if (attempt >= this.retryLimit) {
					break;
				}
				await waitMs(this.retryDelayMs * attempt);
			}
		}
		throw new Error(
			`layout_parsing failed after retry limit (${this.retryLimit}): ${lastError?.message ?? "unknown error"}`,
		);
	}
}
