import type { SkillFrontmatter, SkillFrontmatterRaw } from "./types";

export const SKILL_FRONTMATTER_PARSER_POLICY = {
	strategy: "bounded-splitter",
	directDependencies: [] as const,
	forbiddenTransitiveParsers: [
		"yaml",
		"gray-matter",
		"js-yaml",
		"front-matter",
	] as const,
} as const;

const FRONTMATTER_OPEN = "---";
const FRONTMATTER_KEY_PATTERN = /^([a-z0-9-]+)\s*:\s*(.*)$/;
const FRONTMATTER_LIST_ITEM_PATTERN = /^\s*-\s*(.+)\s*$/;

function unquote(value: string): string {
	const trimmed = value.trim();
	if (
		(trimmed.startsWith('"') && trimmed.endsWith('"')) ||
		(trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseInlineStringList(input: string): string[] {
	const inner = input.slice(1, -1).trim();
	if (inner.length === 0) {
		return [];
	}
	return inner
		.split(",")
		.map((part) => unquote(part))
		.filter((part) => part.length > 0);
}

function parseScalar(input: string): boolean | string | string[] {
	const trimmed = input.trim();
	if (trimmed === "true") {
		return true;
	}
	if (trimmed === "false") {
		return false;
	}
	if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
		return parseInlineStringList(trimmed);
	}
	return unquote(trimmed);
}

function coerceString(value: unknown): string | undefined {
	if (typeof value !== "string") {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function coerceStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const values = value
		.map((item) => (typeof item === "string" ? item.trim() : ""))
		.filter((item) => item.length > 0);
	return values.length > 0 ? values : undefined;
}

function coerceBoolean(value: unknown, defaultValue: boolean): boolean {
	return typeof value === "boolean" ? value : defaultValue;
}

export function normalizeSkillFrontmatter(
	raw: SkillFrontmatterRaw,
): SkillFrontmatter {
	return {
		name: coerceString(raw.name),
		description: coerceString(raw.description),
		version: coerceString(raw.version),
		allowedTools: coerceStringArray(raw["allowed-tools"]),
		disableModelInvocation: coerceBoolean(
			raw["disable-model-invocation"],
			false,
		),
		userInvocable: coerceBoolean(raw["user-invocable"], true),
	};
}

export function parseFrontmatterBlock(block: string): SkillFrontmatterRaw {
	const lines = block.replaceAll("\r\n", "\n").split("\n");
	const raw: SkillFrontmatterRaw = {};
	let openListKey: keyof SkillFrontmatterRaw | null = null;

	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed.length === 0 || trimmed.startsWith("#")) {
			continue;
		}

		if (openListKey != null) {
			const listMatch = line.match(FRONTMATTER_LIST_ITEM_PATTERN);
			if (listMatch) {
				const current = raw[openListKey];
				const parsed = parseScalar(listMatch[1] ?? "");
				const value = typeof parsed === "string" ? parsed : String(parsed);
				if (Array.isArray(current)) {
					current.push(value);
				} else {
					raw[openListKey] = [value];
				}
				continue;
			}
			openListKey = null;
		}

		const keyMatch = line.match(FRONTMATTER_KEY_PATTERN);
		if (!keyMatch) {
			continue;
		}

		const key = keyMatch[1] as keyof SkillFrontmatterRaw;
		const rawValue = keyMatch[2]?.trim() ?? "";
		if (rawValue.length === 0) {
			raw[key] = [];
			openListKey = key;
			continue;
		}
		raw[key] = parseScalar(rawValue);
	}

	return raw;
}

export function parseSkillFrontmatter(
	skillMarkdown: string,
): SkillFrontmatter | null {
	const normalized = skillMarkdown.replaceAll("\r\n", "\n");
	const lines = normalized.split("\n");
	if (lines[0]?.trim() !== FRONTMATTER_OPEN) {
		return null;
	}

	const closingIndex = lines.findIndex(
		(line, idx) => idx > 0 && line.trim() === FRONTMATTER_OPEN,
	);
	if (closingIndex <= 0) {
		return null;
	}

	const frontmatterLines = lines.slice(1, closingIndex);
	return normalizeSkillFrontmatter(
		parseFrontmatterBlock(frontmatterLines.join("\n")),
	);
}
