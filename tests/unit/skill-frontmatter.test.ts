import { describe, expect, it } from "vitest";
import {
	normalizeSkillFrontmatter,
	parseFrontmatterBlock,
	parseSkillFrontmatter,
} from "../../apps/api/src/skill/frontmatter";

describe("skill frontmatter normalization", () => {
	it("maps hyphenated keys to normalized runtime fields once", () => {
		const parsed = normalizeSkillFrontmatter({
			name: "policy-qa",
			description: "Answer policy questions with citations.",
			"allowed-tools": ["Read", "Bash(python *)"],
			"disable-model-invocation": true,
			"user-invocable": false,
			version: "2026.03",
		});

		expect(parsed).toEqual({
			name: "policy-qa",
			description: "Answer policy questions with citations.",
			allowedTools: ["Read", "Bash(python *)"],
			disableModelInvocation: true,
			userInvocable: false,
			version: "2026.03",
		});
		expect(
			(parsed as unknown as Record<string, unknown>)[
				"disable-model-invocation"
			],
		).toBeUndefined();
		expect(
			(parsed as unknown as Record<string, unknown>)["user-invocable"],
		).toBeUndefined();
	});

	it("defaults model flags when frontmatter keys are missing", () => {
		const parsed = normalizeSkillFrontmatter({});
		expect(parsed.disableModelInvocation).toBe(false);
		expect(parsed.userInvocable).toBe(true);
	});
});

describe("skill frontmatter parser", () => {
	it("parses list and boolean fields from a SKILL.md frontmatter block", () => {
		const parsed = parseSkillFrontmatter(`---
name: policy-qa
description: Answer policy questions with citations.
allowed-tools:
  - Read
  - Bash(python *)
disable-model-invocation: true
user-invocable: false
---
# policy-qa`);

		expect(parsed).toEqual({
			name: "policy-qa",
			description: "Answer policy questions with citations.",
			allowedTools: ["Read", "Bash(python *)"],
			disableModelInvocation: true,
			userInvocable: false,
			version: undefined,
		});
	});

	it("parses inline list syntax and ignores unknown keys", () => {
		const raw = parseFrontmatterBlock(
			[
				'name: "invoice-extract"',
				"description: Extract invoice line items.",
				"allowed-tools: [Read, Bash(node scripts/extract.mjs)]",
				"unknown-key: ignored",
			].join("\n"),
		);

		expect(raw["allowed-tools"]).toEqual([
			"Read",
			"Bash(node scripts/extract.mjs)",
		]);
		expect(raw.name).toBe("invoice-extract");
	});

	it("returns null when SKILL.md has no valid frontmatter envelope", () => {
		expect(parseSkillFrontmatter("# no frontmatter")).toBeNull();
		expect(parseSkillFrontmatter("---\nname: x\n# missing close")).toBeNull();
	});
});
