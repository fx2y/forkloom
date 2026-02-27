import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
	getRunContractNames,
	validateRunByName,
} from "../../packages/contracts/src/run-validate";

function contractForExample(name: string): "RunSpec" | "RunState" | "RunEvent" {
	const prefix = name.split(".")[0];
	switch (prefix) {
		case "run-spec":
			return "RunSpec";
		case "run-state":
			return "RunState";
		case "run-event":
			return "RunEvent";
		default:
			throw new Error(`unknown example prefix: ${name}`);
	}
}

describe("contracts/v1 examples", () => {
	const dir = resolve("contracts/v1/examples");
	const files = readdirSync(dir).filter((file) => file.endsWith(".json"));

	for (const file of files) {
		it(`validates ${file}`, () => {
			const payload = JSON.parse(
				readFileSync(resolve(dir, file), "utf8"),
			) as unknown;
			if (file.endsWith(".invalid.json")) {
				const anyValid = getRunContractNames().some(
					(name) => validateRunByName(name, payload).valid,
				);
				expect(anyValid).toBe(false);
				return;
			}

			const contract = contractForExample(file);
			const result = validateRunByName(contract, payload);
			expect(result.valid).toBe(true);
			expect(result.errors).toHaveLength(0);
		});
	}
});
