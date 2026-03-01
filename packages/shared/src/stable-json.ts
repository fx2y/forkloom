import { hashText } from "./hash";

export type StableJsonValue =
	| string
	| number
	| boolean
	| null
	| StableJsonValue[]
	| { [key: string]: StableJsonValue };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonValue(value: unknown): StableJsonValue {
	const encoded = JSON.stringify(value);
	if (encoded === undefined) {
		throw new Error("stable stringify input must be JSON-serializable");
	}
	return JSON.parse(encoded) as StableJsonValue;
}

function canonicalizeStable(value: StableJsonValue): StableJsonValue {
	if (Array.isArray(value)) {
		return value.map((item) => canonicalizeStable(item));
	}
	if (!isRecord(value)) {
		return value;
	}
	const next: { [key: string]: StableJsonValue } = {};
	for (const key of Object.keys(value).sort()) {
		const child = value[key];
		if (child !== undefined) {
			next[key] = canonicalizeStable(child as StableJsonValue);
		}
	}
	return next;
}

export function stableStringify(value: unknown): string {
	return JSON.stringify(canonicalizeStable(toJsonValue(value)));
}

export function hashJSON(value: unknown): string {
	return hashText(stableStringify(value));
}
