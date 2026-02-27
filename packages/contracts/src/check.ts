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

function assertSchemasStrict(): void {
	const schemaFiles = readdirSync(resolve("contracts/v0")).filter((file) =>
		file.endsWith(".schema.json"),
	);
	for (const file of schemaFiles) {
		const schema = JSON.parse(
			readFileSync(resolve("contracts/v0", file), "utf8"),
		) as { type?: string; additionalProperties?: unknown };
		if (schema.type === "object" && schema.additionalProperties !== false) {
			throw new Error(`${file} must have additionalProperties: false`);
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

function assertNoBannedNouns(): void {
	const bannedNouns = [
		"Task",
		"Agent",
		"Thread",
		"Run",
		"ToolCall",
		"Memory",
		"Connector",
		"Doc",
	];
	const schemaDir = resolve("contracts/v0");
	const schemaFiles = readdirSync(schemaDir).filter((f) =>
		f.endsWith(".schema.json"),
	);

	const srcDir = resolve("packages/contracts/src");
	const srcFiles = readdirSync(srcDir).filter(
		(f) => f.endsWith(".ts") && f !== "check.ts",
	);

	const allFiles = [
		...schemaFiles.map((f) => resolve(schemaDir, f)),
		...srcFiles.map((f) => resolve(srcDir, f)),
	];

	for (const fullPath of allFiles) {
		const content = readFileSync(fullPath, "utf8");
		for (const noun of bannedNouns) {
			const pattern = new RegExp(`"${noun}"`);
			if (pattern.test(content)) {
				throw new Error(
					`banned noun detected in ${basename(fullPath)}: "${noun}"`,
				);
			}
		}
	}
}

function main(): void {
	assertSchemasStrict();
	assertNoBannedNouns();
	assertExamples();
	assertTypesInSync();
	console.log("contract check: ok");
}

main();
