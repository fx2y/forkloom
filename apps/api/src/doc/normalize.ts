import { stableStringify } from "@forkloom/shared";

export function normalizeMarkdown(markdown: string): string {
	return markdown
		.replace(/\r\n/g, "\n")
		.replace(/[ \t]+$/gm, "")
		.replace(/\n{3,}/g, "\n\n")
		.trim()
		.concat("\n");
}

export function normalizeJsonValue<T>(value: T): T {
	return JSON.parse(stableStringify(value)) as T;
}

