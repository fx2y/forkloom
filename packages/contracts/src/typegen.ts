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
	const actorSpec = readSchema(V1_SCHEMA_DIR, "ActorSpec");
	const mailboxPost = readSchema(V1_SCHEMA_DIR, "MailboxPost");
	const actorState = readSchema(V1_SCHEMA_DIR, "ActorState");
	const actorEvent = readSchema(V1_SCHEMA_DIR, "ActorEvent");

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
	const mailboxKind = requireLiteralEnum(
		schemaProp(mailboxPost, "kind"),
		"enum",
	);
	const actorStatus = requireLiteralEnum(
		schemaProp(actorState, "status"),
		"enum",
	);
	const actorEventKind = requireLiteralEnum(
		schemaProp(actorEvent, "kind"),
		"enum",
	);

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
		toUnion("MailboxKind", mailboxKind),
		toUnion("ActorStatus", actorStatus),
		toUnion("ActorEventKind", actorEventKind),
		"",
		"export type ArtifactRef = {",
		"\tsha256: string;",
		"};",
		"",
		"export type RunArtifactRef = {",
		"\tsha256: string;",
		"};",
		"",
		"export type ActorArtifactRef = {",
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
		"\tpreview?: Record<string, unknown>;",
		"\tapproval?: Record<string, unknown>;",
		"\tcurrentCommand?: Record<string, unknown>;",
		"\tfiles?: Record<string, unknown>;",
		"\tartifacts: RunArtifactRef[];",
		"};",
		"",
		"export type RunStartedPayload = {",
		"\tscope?: RunScope;",
		"};",
		"",
		"export type RunPreviewedPayload = {",
		"\tpreview: Record<string, unknown>;",
		"};",
		"",
		"export type RunApprovalRequiredPayload = {",
		"\tprofile: string;",
		"};",
		"",
		"export type RunApprovedPayload = {",
		"\tseq: number;",
		"};",
		"",
		"export type RunCommandQueuedPayload = {",
		"\tseq: number;",
		"\tkind: string;",
		"};",
		"",
		"export type PiEventPayload = Record<string, unknown>;",
		"",
		"export type ArtifactWrittenPayload = {",
		"\tsha256: string;",
		"\tkind: string;",
		"};",
		"",
		"export type WorkspaceUpdatedPayload = {",
		"\tworkspaceRef: RunArtifactRef;",
		"};",
		"",
		"export type RunAbortedPayload = {",
		"\tseq: number;",
		"};",
		"",
		"export type RunDonePayload = {",
		"\tresultText: string;",
		"\tstats: Record<string, unknown>;",
		"\tartifacts: string[];",
		"};",
		"",
		"export type RunFailedPayload = {",
		"\terror: string;",
		"};",
		"",
		"export type RunStartedEvent = {",
		"\trunId: string;",
		"\tseq: number;",
		"\tt: string;",
		'\tkind: "run_started";',
		"\tpayload: RunStartedPayload;",
		"};",
		"",
		"export type RunPreviewedEvent = {",
		"\trunId: string;",
		"\tseq: number;",
		"\tt: string;",
		'\tkind: "run_previewed";',
		"\tpayload: RunPreviewedPayload;",
		"};",
		"",
		"export type RunApprovalRequiredEvent = {",
		"\trunId: string;",
		"\tseq: number;",
		"\tt: string;",
		'\tkind: "run_approval_required";',
		"\tpayload: RunApprovalRequiredPayload;",
		"};",
		"",
		"export type RunApprovedEvent = {",
		"\trunId: string;",
		"\tseq: number;",
		"\tt: string;",
		'\tkind: "run_approved";',
		"\tpayload: RunApprovedPayload;",
		"};",
		"",
		"export type RunCommandQueuedEvent = {",
		"\trunId: string;",
		"\tseq: number;",
		"\tt: string;",
		'\tkind: "run_command_queued";',
		"\tpayload: RunCommandQueuedPayload;",
		"};",
		"",
		"export type PiEvent = {",
		"\trunId: string;",
		"\tseq: number;",
		"\tt: string;",
		'\tkind: "pi_event";',
		"\tpayload: PiEventPayload;",
		"};",
		"",
		"export type ArtifactWrittenEvent = {",
		"\trunId: string;",
		"\tseq: number;",
		"\tt: string;",
		'\tkind: "artifact_written";',
		"\tpayload: ArtifactWrittenPayload;",
		"};",
		"",
		"export type WorkspaceUpdatedEvent = {",
		"\trunId: string;",
		"\tseq: number;",
		"\tt: string;",
		'\tkind: "workspace_updated";',
		"\tpayload: WorkspaceUpdatedPayload;",
		"};",
		"",
		"export type RunAbortedEvent = {",
		"\trunId: string;",
		"\tseq: number;",
		"\tt: string;",
		'\tkind: "run_aborted";',
		"\tpayload: RunAbortedPayload;",
		"};",
		"",
		"export type RunDoneEvent = {",
		"\trunId: string;",
		"\tseq: number;",
		"\tt: string;",
		'\tkind: "run_done";',
		"\tpayload: RunDonePayload;",
		"};",
		"",
		"export type RunFailedEvent = {",
		"\trunId: string;",
		"\tseq: number;",
		"\tt: string;",
		'\tkind: "run_failed";',
		"\tpayload: RunFailedPayload;",
		"};",
		"",
		"export type RunEvent =",
		"\t| RunStartedEvent",
		"\t| RunPreviewedEvent",
		"\t| RunApprovalRequiredEvent",
		"\t| RunApprovedEvent",
		"\t| RunCommandQueuedEvent",
		"\t| PiEvent",
		"\t| ArtifactWrittenEvent",
		"\t| WorkspaceUpdatedEvent",
		"\t| RunAbortedEvent",
		"\t| RunDoneEvent",
		"\t| RunFailedEvent;",
		"",
		"export type TerminalRunEvent = RunAbortedEvent | RunDoneEvent | RunFailedEvent;",
		"",
		"export type ActorSpec = {",
		"\tactorId: string;",
		"\tname: string;",
		"\tworkspaceId?: string;",
		"\tmemRef?: string;",
		"};",
		"",
		"export type MailboxPost = {",
		"\tkind: MailboxKind;",
		"\ttext: string;",
		"\tattachments: ActorArtifactRef[];",
		"\tdedupeKey?: string;",
		"\tmetadata?: Record<string, unknown>;",
		"};",
		"",
		"export type ActorState = {",
		"\tactorId: string;",
		"\tname: string;",
		"\tstatus: ActorStatus;",
		"\tmailboxCursor: number;",
		"\tupdatedAt: string;",
		"};",
		"",
		"export type ActorEvent = {",
		"\tactorId: string;",
		"\tseq: number;",
		"\tt: string;",
		"\tkind: ActorEventKind;",
		"\tpayload: Record<string, unknown>;",
		"};",
		"",
	].join("\n");
}

if (process.argv.includes("--write")) {
	writeFileSync(TYPES_PATH, renderTypes(), "utf8");
}
