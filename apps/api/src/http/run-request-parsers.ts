import { validateRunByName } from "@forkloom/contracts";
import type { Request } from "express";
import { HttpError } from "../errors";
import type { RunProfile, RunScope, RunSpecModel } from "../run/ports";
import { RUN_PUBLIC_COMMAND_KINDS } from "../run/public-surface";
import {
	parseArtifactPointer,
	parseArtifactPointers,
} from "./contract-parsers";
import { parseEventReplayCursor } from "./event-stream";

function parseRunScope(input: unknown): RunScope {
	if (input === "me" || input === "team" || input === "org") {
		return input;
	}
	throw new HttpError(400, "scope must be one of me|team|org");
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

	return {
		runId,
		scope: parseRunScope(record.scope),
		userMsg,
		attachments: parseArtifactPointers(record.attachments),
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

export function parseRunCursor(req: Request): {
	sinceEventId: number;
	limit: number;
} {
	return parseEventReplayCursor(req);
}
