export type JsonValue =
	| string
	| number
	| boolean
	| null
	| JsonValue[]
	| { [key: string]: JsonValue };

const VOLATILE_KEYS = new Set([
	"timestamp",
	"usage",
	"cost",
	"elapsedMs",
	"requestId",
	"sessionStart",
	"sessionEnd",
]);

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortObjectKeys(input: { [key: string]: JsonValue }): {
	[key: string]: JsonValue;
} {
	const result: { [key: string]: JsonValue } = {};
	for (const key of Object.keys(input).sort()) {
		const value = input[key];
		if (value !== undefined) {
			result[key] = value;
		}
	}
	return result;
}

export function canonicalizeValue(value: JsonValue): JsonValue {
	if (Array.isArray(value)) {
		return value.map((item) => canonicalizeValue(item));
	}

	if (!isRecord(value)) {
		return value;
	}

	const next: { [key: string]: JsonValue } = {};
	for (const [key, raw] of Object.entries(value)) {
		if (VOLATILE_KEYS.has(key)) {
			continue;
		}

		const canonicalChild = canonicalizeValue(raw);
		if (isRecord(canonicalChild) && Object.keys(canonicalChild).length === 0) {
			continue;
		}

		next[key] = canonicalChild;
	}

	return sortObjectKeys(next);
}

export function canonicalizeJsonLine(line: string): string {
	const parsed = JSON.parse(line) as JsonValue;
	const canonical = canonicalizeValue(parsed);
	return JSON.stringify(canonical);
}

export function canonicalizeJsonl(content: string): string {
	const lines = content
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0);

	return (
		lines.map((line) => canonicalizeJsonLine(line)).join("\n") +
		(lines.length ? "\n" : "")
	);
}
