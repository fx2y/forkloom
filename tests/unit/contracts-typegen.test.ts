import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { renderTypes } from "../../packages/contracts/src/typegen";

describe("contracts typegen", () => {
	it("renders v1 run types and v0 Skill shape from schemas", () => {
		const out = renderTypes();
		const skillSchema = JSON.parse(
			readFileSync(resolve("contracts/v0/Skill.schema.json"), "utf8"),
		) as {
			properties: Record<string, unknown>;
			required?: string[];
		};
		const required = new Set(skillSchema.required ?? []);

		expect(out).toContain("export type RunEventKind =");
		expect(out).toContain('\t| "run_started"');
		expect(out).toContain('\t| "run_previewed"');
		expect(out).toContain("export type RunSpec = {");
		expect(out).toContain("export type RunState = {");
		expect(out).toContain("\tpreview?: Record<string, unknown>;");
		expect(out).toContain("export type RunPreviewedPayload = {");
		expect(out).toContain("export type RunDonePayload = {");
		expect(out).toContain("export type RunEvent =");
		expect(out).toContain("export type Skill = {");
		for (const key of Object.keys(skillSchema.properties)) {
			expect(out).toContain(`\t${key}${required.has(key) ? "" : "?"}:`);
		}
		expect(out).not.toContain("disableModelInvocation");
		expect(out).not.toContain("userInvocable");
	});
});
