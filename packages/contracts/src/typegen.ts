import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const V0_SCHEMA_DIR = resolve("contracts/v0");
const V1_SCHEMA_DIR = resolve("contracts/v1");
const TYPES_PATH = resolve("packages/contracts/src/types.ts");

function requireLiteralEnum(
	schema: Record<string, unknown>,
	path: string,
): string[] {
	const maybeEnum = schema[path] as string[] | undefined;
	if (
		!Array.isArray(maybeEnum) ||
		maybeEnum.some((v) => typeof v !== "string")
	) {
		throw new Error(`expected enum array at ${path}`);
	}
	return maybeEnum;
}

function readSchema(dir: string, name: string): Record<string, unknown> {
	const fullPath = resolve(dir, `${name}.schema.json`);
	return JSON.parse(readFileSync(fullPath, "utf8")) as Record<string, unknown>;
}

function schemaProp(
	schema: Record<string, unknown>,
	key: string,
): Record<string, unknown> {
	const properties = schema.properties as Record<string, unknown> | undefined;
	if (!properties || typeof properties !== "object") {
		throw new Error("schema missing properties block");
	}
	const prop = properties[key] as Record<string, unknown> | undefined;
	if (!prop || typeof prop !== "object") {
		throw new Error(`schema missing property: ${key}`);
	}
	return prop;
}

function toUnion(name: string, values: string[]): string {
	const oneLine = `export type ${name} = ${values.map((value) => JSON.stringify(value)).join(" | ")};`;
	if (oneLine.length <= 80) {
		return oneLine;
	}
	return [
		`export type ${name} =`,
		...values.map((value, idx) => {
			const suffix = idx === values.length - 1 ? ";" : "";
			return `\t| ${JSON.stringify(value)}${suffix}`;
		}),
	].join("\n");
}

export function renderTypes(): string {
	const message = readSchema(V0_SCHEMA_DIR, "Message");
	const artifact = readSchema(V0_SCHEMA_DIR, "Artifact");
	const workflow = readSchema(V0_SCHEMA_DIR, "Workflow");
	const extension = readSchema(V0_SCHEMA_DIR, "Extension");
	const runSpec = readSchema(V1_SCHEMA_DIR, "RunSpec");
	const runState = readSchema(V1_SCHEMA_DIR, "RunState");
	const runEvent = readSchema(V1_SCHEMA_DIR, "RunEvent");

	const delivery = requireLiteralEnum(schemaProp(message, "delivery"), "enum");
	const scope = requireLiteralEnum(schemaProp(message, "scope"), "enum");
	const role = requireLiteralEnum(schemaProp(message, "role"), "enum");
	const artifactType = requireLiteralEnum(schemaProp(artifact, "type"), "enum");
	const workflowStatus = requireLiteralEnum(
		schemaProp(workflow, "status"),
		"enum",
	);
	const capabilityItems = (schemaProp(extension, "capabilities").items ??
		null) as Record<string, unknown> | null;
	if (!capabilityItems || typeof capabilityItems !== "object") {
		throw new Error("extension.capabilities.items is required");
	}
	const capability = requireLiteralEnum(capabilityItems, "enum");
	const runScope = requireLiteralEnum(schemaProp(runSpec, "scope"), "enum");
	const runStatus = requireLiteralEnum(schemaProp(runState, "status"), "enum");
	const runEventKind = requireLiteralEnum(schemaProp(runEvent, "kind"), "enum");

	return [
		"/*",
		" * GENERATED FILE - DO NOT EDIT.",
		" * Run: pnpm exec tsx packages/contracts/src/typegen.ts --write",
		" */",
		"",
		toUnion("Delivery", delivery),
		toUnion("Scope", scope),
		toUnion("Role", role),
		toUnion("ArtifactType", artifactType),
		toUnion("WorkflowStatus", workflowStatus),
		toUnion("ExtensionCapability", capability),
		toUnion("RunScope", runScope),
		toUnion("RunStatus", runStatus),
		toUnion("RunEventKind", runEventKind),
		"",
		"export type ArtifactRef = {",
		"\tsha256: string;",
		"};",
		"",
		"export type RunArtifactRef = {",
		"\tsha256: string;",
		"};",
		"",
		"export type Message = {",
		"\tid: string;",
		"\tts: string;",
		"\trole: Role;",
		"\ttext: string;",
		"\tscope: Scope;",
		"\tthreadId: string;",
		"\tdelivery: Delivery;",
		"\tattachments: ArtifactRef[];",
		"\tmeta: Record<string, unknown>;",
		"};",
		"",
		"export type Artifact = {",
		"\tsha256: string;",
		"\turi: string;",
		"\tmime: string;",
		"\tbytes: number;",
		"\tcreatedAt: string;",
		"\ttype: ArtifactType;",
		"\tparents: string[];",
		"\tmeta: Record<string, unknown>;",
		"};",
		"",
		"export type Workflow = {",
		"\tname: string;",
		"\trunId: string;",
		"\tstatus: WorkflowStatus;",
		"\tidempotencyKey: string;",
		"\tinput?: ArtifactRef | Record<string, unknown>;",
		"};",
		"",
		"export type Skill = {",
		"\tskillId: string;",
		"\tpath: string;",
		"\tname: string;",
		"\tdescription: string;",
		"\tallowedTools?: string[];",
		"\tversion?: string;",
		"};",
		"",
		"export type Extension = {",
		"\tname: string;",
		"\tversion: string;",
		"\tentry: string;",
		"\tcapabilities: ExtensionCapability[];",
		"};",
		"",
		"export type RunSpec = {",
		"\trunId: string;",
		"\tscope: RunScope;",
		"\tuserMsg: string;",
		"\tattachments: RunArtifactRef[];",
		"\tworkdirRef?: RunArtifactRef;",
		"\tmodelPref?: string;",
		"};",
		"",
		"export type RunState = {",
		"\trunId: string;",
		"\tstatus: RunStatus;",
		"\tstartedAt: string;",
		"\tfinishedAt?: string;",
		"\tdbosWfId: string;",
		"\tpiSessionId?: string;",
		"\tpiSessionFile?: string;",
		"\tartifacts: RunArtifactRef[];",
		"};",
		"",
		"export type RunEvent = {",
		"\trunId: string;",
		"\tseq: number;",
		"\tt: string;",
		"\tkind: RunEventKind;",
		"\tpayload: Record<string, unknown>;",
		"};",
		"",
	].join("\n");
}

if (process.argv.includes("--write")) {
	writeFileSync(TYPES_PATH, renderTypes(), "utf8");
}
