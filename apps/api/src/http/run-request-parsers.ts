import { validateRunByName } from "@forkloom/contracts";
import type { SpanRef } from "@forkloom/contracts";
import type { Request } from "express";
import { HttpError } from "../errors";
import type { RunProfile, RunScope, RunSpecModel } from "../run/ports";
import { RUN_PUBLIC_COMMAND_KINDS } from "../run/public-surface";
import {
	SKILL_INVOCATION_PREFIX,
	hasSkillInvocationPrefix,
	parseSkillInvocation,
} from "../skill";
import { canonicalizeWriteTarget } from "../tenancy/write-target";
import {
	parseArtifactPointer,
	parseArtifactPointers,
} from "./contract-parsers";
import { parseEventReplayCursor } from "./event-stream";

export const RUN_SKILL_TEXT_COMMAND_PREFIX = SKILL_INVOCATION_PREFIX;
export const RUN_SKILL_TEXT_COMMAND_KINDS = [
	"prompt",
	"followUp",
	"steer",
] as const;
export const RUN_SKILL_TEXT_COMMAND_NOTE =
	"explicit skill activation stays in existing text command payloads; kind never becomes skill";

function parseRunScope(input: unknown): RunScope {
	if (input === "me" || input === "team" || input === "org") {
		return input;
	}
	throw new HttpError(400, "scope must be one of me|team|org");
}

function parseWriteTarget(input: unknown): "org" | "ws" | "member" {
	if (input === "org" || input === "ws" || input === "member") {
		return input;
	}
	throw new HttpError(400, "writeTarget must be one of org|ws|member");
}

function parseRunProfile(input: unknown): RunProfile {
	if (input === "safe" || input === "std" || input === "priv") {
		return input;
	}
	throw new HttpError(400, "profile must be one of safe|std|priv");
}

export function parseRunCreatePayload(input: unknown): RunSpecModel {
	const result = validateRunByName("RunSpec", input);
	if (!result.valid) {
		throw new HttpError(
			400,
			`invalid run payload: ${result.errors.join("; ")}`,
		);
	}

	const record = input as Record<string, unknown>;
	const runId = String(record.runId);
	const userMsg = String(record.userMsg).trim();
	if (userMsg.length === 0) {
		throw new HttpError(400, "userMsg is required");
	}

	const orgId = String(record.orgId ?? "").trim();
	if (orgId.length === 0) {
		throw new HttpError(400, "orgId is required");
	}
	const wsId =
		typeof record.wsId === "string" && record.wsId.trim()
			? record.wsId.trim()
			: undefined;
	const memberId =
		typeof record.memberId === "string" && record.memberId.trim()
			? record.memberId.trim()
			: undefined;
	const writeTarget = parseWriteTarget(record.writeTarget);
	const canonicalScope = (() => {
		try {
			return canonicalizeWriteTarget(writeTarget, {
				orgId,
				wsId,
				memberId,
			});
		} catch (error) {
			throw new HttpError(
				400,
				error instanceof Error ? error.message : String(error),
			);
		}
	})();

	return {
		runId,
		scope: parseRunScope(record.scope),
		userMsg,
		attachments: parseArtifactPointers(record.attachments),
		orgId: canonicalScope.orgId,
		wsId: canonicalScope.wsId,
		memberId: canonicalScope.memberId,
		writeTarget: canonicalScope.writeTarget,
		workdirRef:
			record.workdirRef == null
				? undefined
				: parseArtifactPointer(record.workdirRef, "workdirRef"),
		modelPref:
			typeof record.modelPref === "string" ? record.modelPref : undefined,
		profile:
			record.profile == null ? undefined : parseRunProfile(record.profile),
	};
}

export function parseRunCommandPayload(input: unknown): {
	kind: "approve" | "prompt" | "followUp" | "steer" | "abort";
	payload: Record<string, unknown>;
	dedupeKey?: string | undefined;
} {
	if (input == null || typeof input !== "object" || Array.isArray(input)) {
		throw new HttpError(400, "command payload must be an object");
	}
	const record = input as Record<string, unknown>;
	const kind = record.kind;
	if (
		kind !== "approve" &&
		kind !== "prompt" &&
		kind !== "followUp" &&
		kind !== "steer" &&
		kind !== "abort"
	) {
		throw new HttpError(
			400,
			`kind must be one of ${RUN_PUBLIC_COMMAND_KINDS.join("|")}`,
		);
	}
	let payload: Record<string, unknown> = {};
	if (record.payload != null) {
		if (typeof record.payload !== "object" || Array.isArray(record.payload)) {
			throw new HttpError(400, "payload must be an object");
		}
		payload = record.payload as Record<string, unknown>;
	}
	if (isTextCommandKind(kind)) {
		const text = payload.text;
		if (typeof text !== "string" || text.trim().length === 0) {
			throw new HttpError(400, `${kind} payload.text is required`);
		}
		const normalized = text.trim();
		if (
			hasSkillInvocationPrefix(normalized) &&
			parseSkillInvocation(normalized) == null
		) {
			throw new HttpError(
				400,
				"invalid /skill invocation; expected /skill:<name> [args]",
			);
		}
		payload = {
			...payload,
			text: normalized,
		};
	}
	return {
		kind,
		payload,
		dedupeKey:
			typeof record.dedupeKey === "string" && record.dedupeKey.length > 0
				? record.dedupeKey
				: undefined,
	};
}

export function parseRunFileExportPayload(input: unknown): {
	paths?: string[] | undefined;
} {
	if (input == null) {
		return {};
	}
	if (typeof input !== "object" || Array.isArray(input)) {
		throw new HttpError(400, "file export payload must be an object");
	}
	const record = input as Record<string, unknown>;
	if (record.paths == null) {
		return {};
	}
	if (
		!Array.isArray(record.paths) ||
		record.paths.some(
			(path) => typeof path !== "string" || path.trim().length === 0,
		)
	) {
		throw new HttpError(400, "paths must be a non-empty string array");
	}
	return {
		paths: record.paths.map((path) => String(path).trim()),
	};
}

const SKILL_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function parseRunSkillPreviewPayload(input: unknown): {
	skillName: string;
	args?: string | undefined;
} {
	if (input == null || typeof input !== "object" || Array.isArray(input)) {
		throw new HttpError(400, "skill preview payload must be an object");
	}
	const record = input as Record<string, unknown>;
	const skillName =
		typeof record.skillName === "string" ? record.skillName.trim() : "";
	if (skillName.length === 0) {
		throw new HttpError(400, "skillName is required");
	}
	if (!SKILL_NAME_PATTERN.test(skillName)) {
		throw new HttpError(400, "skillName must match ^[a-z0-9]+(-[a-z0-9]+)*$");
	}
	if (record.args != null && typeof record.args !== "string") {
		throw new HttpError(400, "args must be a string when provided");
	}
	const args = typeof record.args === "string" ? record.args.trim() : undefined;
	return {
		skillName,
		args: args && args.length > 0 ? args : undefined,
	};
}

function parsePositiveIntLimit(input: unknown): number | undefined {
	if (input == null) {
		return undefined;
	}
	if (typeof input !== "number" || !Number.isInteger(input)) {
		throw new HttpError(400, "search limit must be an integer");
	}
	if (input < 1 || input > 100) {
		throw new HttpError(400, "search limit must be in [1,100]");
	}
	return input;
}

export function parseRunDocSearchPayload(input: unknown): {
	query: string;
	scope: string;
	limit?: number | undefined;
} {
	if (input == null || typeof input !== "object" || Array.isArray(input)) {
		throw new HttpError(400, "doc search payload must be an object");
	}
	const record = input as Record<string, unknown>;
	if (typeof record.query !== "string" || record.query.trim().length === 0) {
		throw new HttpError(400, "doc search query is required");
	}
	const scope =
		typeof record.scope === "string" && record.scope.trim().length > 0
			? record.scope.trim()
			: "*";
	return {
		query: record.query.trim(),
		scope,
		limit: parsePositiveIntLimit(record.limit),
	};
}

export function parseRunDocResolvePayload(input: unknown): SpanRef {
	if (input == null || typeof input !== "object" || Array.isArray(input)) {
		throw new HttpError(400, "doc resolve payload must be an object");
	}
	const record = input as Record<string, unknown>;
	const candidate = record.span;
	const validation = validateRunByName("SpanRef", candidate);
	if (!validation.valid) {
		throw new HttpError(
			400,
			`invalid span payload: ${validation.errors.join("; ")}`,
		);
	}
	return candidate as SpanRef;
}

export function parseRunDocIngestPayload(input: unknown): {
	mime: string;
	body: Buffer;
} {
	if (input == null || typeof input !== "object" || Array.isArray(input)) {
		throw new HttpError(400, "doc ingest payload must be an object");
	}
	const record = input as Record<string, unknown>;
	if (typeof record.mime !== "string" || record.mime.trim().length === 0) {
		throw new HttpError(400, "doc ingest mime is required");
	}
	if (
		typeof record.bodyBase64 !== "string" ||
		record.bodyBase64.trim().length === 0
	) {
		throw new HttpError(400, "doc ingest bodyBase64 is required");
	}
	let body: Buffer;
	try {
		body = Buffer.from(record.bodyBase64, "base64");
	} catch {
		throw new HttpError(400, "doc ingest bodyBase64 is invalid");
	}
	if (body.byteLength === 0) {
		throw new HttpError(400, "doc ingest body is empty");
	}
	return {
		mime: record.mime.trim(),
		body,
	};
}

export function parseRunCursor(req: Request): {
	sinceEventId: number;
	limit: number;
} {
	return parseEventReplayCursor(req);
}

function isTextCommandKind(
	kind: "approve" | "prompt" | "followUp" | "steer" | "abort",
): kind is "prompt" | "followUp" | "steer" {
	return (
		kind === RUN_SKILL_TEXT_COMMAND_KINDS[0] ||
		kind === RUN_SKILL_TEXT_COMMAND_KINDS[1] ||
		kind === RUN_SKILL_TEXT_COMMAND_KINDS[2]
	);
}
