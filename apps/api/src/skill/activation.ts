import type { SkillInvocation } from "./types";

export const SKILL_INVOCATION_PREFIX = "/skill:";
const SKILL_INVOCATION_PATTERN = /^\/skill:([a-z0-9]+(?:-[a-z0-9]+)*)\s*(.*)$/s;
const SKILL_FRONTMATTER_MARKER = "---";
const SKILL_ARGUMENTS_TOKEN = "$ARGUMENTS";

export function hasSkillInvocationPrefix(text: string): boolean {
	return text.trimStart().startsWith(SKILL_INVOCATION_PREFIX);
}

export function parseSkillInvocation(text: string): SkillInvocation | null {
	const match = text.trim().match(SKILL_INVOCATION_PATTERN);
	if (!match) {
		return null;
	}
	return {
		skillName: match[1] ?? "",
		args: (match[2] ?? "").trim(),
	};
}

export function renderActivatedSkillPrompt(
	skillMarkdown: string,
	args: string,
): string {
	const body = stripSkillFrontmatter(skillMarkdown);
	const rendered = body.replaceAll(SKILL_ARGUMENTS_TOKEN, args).trim();
	if (!body.includes(SKILL_ARGUMENTS_TOKEN) && args.length > 0) {
		return rendered.length > 0 ? `${rendered}\n\nUser: ${args}` : `User: ${args}`;
	}
	return rendered;
}

function stripSkillFrontmatter(skillMarkdown: string): string {
	const normalized = skillMarkdown.replaceAll("\r\n", "\n");
	const lines = normalized.split("\n");
	if (lines[0]?.trim() !== SKILL_FRONTMATTER_MARKER) {
		return normalized.trim();
	}
	const closingIndex = lines.findIndex(
		(line, idx) => idx > 0 && line.trim() === SKILL_FRONTMATTER_MARKER,
	);
	if (closingIndex <= 0) {
		return normalized.trim();
	}
	return lines.slice(closingIndex + 1).join("\n").trim();
}
