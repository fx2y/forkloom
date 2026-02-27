import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { renderTypes } from "./typegen";
import { getContractNames, validateByName } from "./validate";

const EXAMPLES_DIR = resolve("contracts/v0/examples");
const TYPES_PATH = resolve("packages/contracts/src/types.ts");

function contractForExample(name: string): string {
	const head = name.split(".")[0];
	switch (head) {
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
			return "";
	}
}

function assertExamples(): void {
	const files = readdirSync(EXAMPLES_DIR).filter((file) =>
		file.endsWith(".json"),
	);
	for (const file of files) {
		const payload = JSON.parse(
			readFileSync(resolve(EXAMPLES_DIR, file), "utf8"),
		) as unknown;

		if (file.endsWith(".invalid.json")) {
			const anyValid = getContractNames().some(
				(name) => validateByName(name, payload).valid,
			);
			if (anyValid) {
				throw new Error(
					`invalid fixture accepted by at least one schema: ${file}`,
				);
			}
			continue;
		}

		const contract = contractForExample(file);
		if (!contract) {
			throw new Error(`cannot infer schema from fixture name: ${file}`);
		}

		const result = validateByName(contract as never, payload);
		if (!result.valid) {
			throw new Error(
				`${file} failed ${contract}: ${result.errors.join("; ") || "unknown"}`,
			);
		}
	}
}

function assertTypesInSync(): void {
	const expected = renderTypes();
	const existing = readFileSync(TYPES_PATH, "utf8");
	if (existing !== expected) {
		throw new Error(
			`types.ts is stale; run: pnpm exec tsx ${basename(resolve("packages/contracts/src/typegen.ts"))} --write`,
		);
	}
}

function main(): void {
	assertExamples();
	assertTypesInSync();
}

main();
