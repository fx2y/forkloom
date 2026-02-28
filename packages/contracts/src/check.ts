import { readFileSync, readdirSync } from "node:fs";
import { basename, resolve } from "node:path";
import { renderTypes } from "./typegen";
import {
	type ActorContractName,
	type ContractName,
	type RunContractName,
	getActorContractNames,
	getContractNames,
	getRunContractNames,
	validateActorByName,
	validateByName,
	validateRunByName,
} from "./validate";

const V0_EXAMPLES_DIR = resolve("contracts/v0/examples");
const V1_EXAMPLES_DIR = resolve("contracts/v1/examples");
const V0_SCHEMA_DIR = resolve("contracts/v0");
const V1_SCHEMA_DIR = resolve("contracts/v1");
const TYPES_PATH = resolve("packages/contracts/src/types.ts");

function contractForV0Example(name: string): ContractName | "" {
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

function contractForV1Example(
	name: string,
): RunContractName | ActorContractName | "" {
	const head = name.split(".")[0];
	switch (head) {
		case "actor-spec":
			return "ActorSpec";
		case "mailbox-post":
			return "MailboxPost";
		case "actor-state":
			return "ActorState";
		case "actor-event":
			return "ActorEvent";
		case "run-spec":
			return "RunSpec";
		case "run-state":
			return "RunState";
		case "run-event":
			return "RunEvent";
		default:
			return "";
	}
}

type Validation = {
	valid: boolean;
	errors: string[];
};

function assertExamples<TName extends string>(params: {
	examplesDir: string;
	inferContract: (file: string) => TName | "";
	getNames: () => TName[];
	validate: (name: TName, payload: unknown) => Validation;
}): void {
	const files = readdirSync(params.examplesDir)
		.filter((file) => file.endsWith(".json"))
		.sort();

	for (const file of files) {
		const payload = JSON.parse(
			readFileSync(resolve(params.examplesDir, file), "utf8"),
		) as unknown;

		if (file.endsWith(".invalid.json")) {
			const anyValid = params.getNames().some((name) => {
				return params.validate(name, payload).valid;
			});
			if (anyValid) {
				throw new Error(
					`invalid fixture accepted by at least one schema: ${file}`,
				);
			}
			continue;
		}

		const contract = params.inferContract(file);
		if (!contract) {
			throw new Error(`cannot infer schema from fixture name: ${file}`);
		}

		const result = params.validate(contract, payload);
		if (!result.valid) {
			throw new Error(
				`${file} failed ${contract}: ${result.errors.join("; ") || "unknown"}`,
			);
		}
	}
}

function assertV0Examples(): void {
	assertExamples({
		examplesDir: V0_EXAMPLES_DIR,
		inferContract: contractForV0Example,
		getNames: getContractNames,
		validate: validateByName,
	});
}

function assertV1Examples(): void {
	assertExamples({
		examplesDir: V1_EXAMPLES_DIR,
		inferContract: contractForV1Example,
		getNames: () => [...getRunContractNames(), ...getActorContractNames()],
		validate: (name, payload) => {
			if (name === "RunSpec" || name === "RunState" || name === "RunEvent") {
				return validateRunByName(name, payload);
			}
			return validateActorByName(name, payload);
		},
	});
}

function assertSchemasStrict(schemaDir: string): void {
	const schemaFiles = readdirSync(schemaDir).filter((file) =>
		file.endsWith(".schema.json"),
	);
	for (const file of schemaFiles) {
		const schema = JSON.parse(
			readFileSync(resolve(schemaDir, file), "utf8"),
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

function assertNoBannedNounsInV0(): void {
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
	const schemaFiles = readdirSync(V0_SCHEMA_DIR).filter((file) =>
		file.endsWith(".schema.json"),
	);

	const srcDir = resolve("packages/contracts/src");
	const srcFiles = readdirSync(srcDir).filter(
		(f) => f.endsWith(".ts") && f !== "check.ts",
	);

	const allFiles = [
		...schemaFiles.map((file) => resolve(V0_SCHEMA_DIR, file)),
		...srcFiles.map((file) => resolve(srcDir, file)),
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

function assertRunNounsScopedToV1(): void {
	const runNouns: RunContractName[] = ["RunSpec", "RunState", "RunEvent"];
	const actorNouns: ActorContractName[] = [
		"ActorSpec",
		"MailboxPost",
		"ActorState",
		"ActorEvent",
	];
	const v0Files = readdirSync(V0_SCHEMA_DIR).filter((file) =>
		file.endsWith(".schema.json"),
	);
	const v1Files = readdirSync(V1_SCHEMA_DIR).filter((file) =>
		file.endsWith(".schema.json"),
	);

	for (const file of v0Files) {
		const content = readFileSync(resolve(V0_SCHEMA_DIR, file), "utf8");
		for (const noun of [...runNouns, ...actorNouns]) {
			if (new RegExp(`"${noun}"`).test(content)) {
				throw new Error(`v1 noun leaked into v0 schema ${file}: "${noun}"`);
			}
		}
	}

	for (const noun of [...runNouns, ...actorNouns]) {
		const found = v1Files.some((file) => {
			const content = readFileSync(resolve(V1_SCHEMA_DIR, file), "utf8");
			return new RegExp(`"${noun}"`).test(content);
		});
		if (!found) {
			throw new Error(`required v1 noun missing from v1 schemas: "${noun}"`);
		}
	}
}

function main(): void {
	assertSchemasStrict(V0_SCHEMA_DIR);
	assertSchemasStrict(V1_SCHEMA_DIR);
	assertNoBannedNounsInV0();
	assertRunNounsScopedToV1();
	assertV0Examples();
	assertV1Examples();
	assertTypesInSync();
	console.log("contract check: ok");
}

main();
