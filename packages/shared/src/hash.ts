import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

export type ArtifactDescriptor = {
	sha256: string;
	bytes: number;
};

export function hashBytes(input: Uint8Array): string {
	return createHash("sha256").update(input).digest("hex");
}

export function hashText(input: string): string {
	return hashBytes(Buffer.from(input, "utf8"));
}

export function hashFile(path: string): ArtifactDescriptor {
	const body = readFileSync(path);
	return {
		sha256: hashBytes(body),
		bytes: body.byteLength,
	};
}

export function casKey(sha256: string): string {
	return `cas/${sha256.slice(0, 2)}/${sha256}`;
}

export function isSha256(value: string): boolean {
	return /^[a-f0-9]{64}$/.test(value);
}
