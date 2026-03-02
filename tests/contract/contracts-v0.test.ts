import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	getContractNames,
	validateByName,
} from "../../packages/contracts/src/validate";

function contractForExample(
	name: string,
): "Message" | "Artifact" | "Workflow" | "Skill" | "Extension" {
	const prefix = name.split(".")[0];
	switch (prefix) {
		case "message":
			return "Message";
		case "artifact":
			return "Artifact";
		case "workflow":
			return "Workflow";
		case "skill":
			return "Skill";
		case "extension":
			return "Extension";
		default:
			throw new Error(`unknown example prefix: ${name}`);
	}
}

describe("contracts/v0 examples", () => {
	const dir = resolve("contracts/v0/examples");
	const files = readdirSync(dir).filter((file) => file.endsWith(".json"));

	for (const file of files) {
		it(`validates ${file}`, () => {
			const payload = JSON.parse(
				readFileSync(resolve(dir, file), "utf8"),
			) as unknown;
			if (file.endsWith(".invalid.json")) {
				const anyValid = getContractNames().some(
					(name) => validateByName(name, payload).valid,
				);
				expect(anyValid).toBe(false);
				return;
			}

			const contract = contractForExample(file);
			const result = validateByName(contract, payload);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});
	}

	it("rejects spec08-only frontmatter keys in v0 Skill manifests", () => {
		const payload = JSON.parse(
			readFileSync(
				resolve("contracts/v0/examples/skill.spec08.invalid.json"),
				"utf8",
			),
		) as unknown;
		const result = validateByName("Skill", payload);
		expect(result.valid).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
	});
});
