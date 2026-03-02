import type { SkillIndexEntry } from "./types";

export type SkillXmlOptions = {
	maxSkills: number;
	maxDescriptionChars: number;
};

export function buildAvailableSkillsXml(
	entries: readonly SkillIndexEntry[],
	options: SkillXmlOptions,
): string {
	const rows: string[] = [];
	for (const entry of entries) {
		if (entry.hidden) {
			continue;
		}
		if (rows.length >= options.maxSkills) {
			break;
		}
		rows.push(
			`  <skill><name>${escapeXml(entry.name)}</name><description>${escapeXml(truncateDescription(entry.description, options.maxDescriptionChars))}</description></skill>`,
		);
	}
	if (rows.length === 0) {
		return "<available_skills></available_skills>";
	}
	return `<available_skills>\n${rows.join("\n")}\n</available_skills>`;
}

function truncateDescription(value: string, maxChars: number): string {
	if (value.length <= maxChars) {
		return value;
	}
	const head = value.slice(0, Math.max(0, maxChars - 3)).trimEnd();
	return `${head}...`;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}
