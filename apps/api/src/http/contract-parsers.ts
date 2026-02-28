import { isSha256 } from "@forkloom/shared";
import { HttpError } from "../errors";

export function parseArtifactPointer(
	input: unknown,
	label: string,
): { sha256: string } {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		throw new HttpError(400, `${label} must be an object`);
	}
	const record = input as Record<string, unknown>;
	if (typeof record.sha256 !== "string" || !isSha256(record.sha256)) {
		throw new HttpError(400, `${label}.sha256 must be a sha256`);
	}
	return { sha256: record.sha256 };
}

export function parseArtifactPointers(input: unknown): { sha256: string }[] {
	if (!Array.isArray(input)) {
		return [];
	}
	return input.map((item, index) =>
		parseArtifactPointer(item, `attachments[${index}]`),
	);
}
