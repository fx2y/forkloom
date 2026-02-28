import { validateRunByName } from "@forkloom/contracts";
import { isSha256 } from "@forkloom/shared";
import type { Request } from "express";
import { HttpError } from "../errors";
import type { RunScope, RunSpecModel } from "../run/ports";
import { parseEventReplayCursor } from "./event-stream";

function parseRunScope(input: unknown): RunScope {
	if (input === "me" || input === "team" || input === "org") {
		return input;
	}
	throw new HttpError(400, "scope must be one of me|team|org");
}

function parseArtifactPointer(
	input: unknown,
	label: string,
): { sha256: string } {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		throw new HttpError(400, `${label} must be an object`);
	}
	const record = input as Record<string, unknown>;
	if (typeof record.sha256 !== "string" || !isSha256(record.sha256)) {
		throw new HttpError(400, `${label}.sha256 must be a sha256`);
	}
	return { sha256: record.sha256 };
}

function parseAttachments(input: unknown): { sha256: string }[] {
	if (!Array.isArray(input)) {
		return [];
	}
	return input.map((item, index) =>
		parseArtifactPointer(item, `attachments[${index}]`),
	);
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
		attachments: parseAttachments(record.attachments),
		workdirRef:
			record.workdirRef == null
				? undefined
				: parseArtifactPointer(record.workdirRef, "workdirRef"),
		modelPref:
			typeof record.modelPref === "string" ? record.modelPref : undefined,
	};
}

export function parseRunCursor(req: Request): {
	sinceEventId: number;
	limit: number;
} {
	return parseEventReplayCursor(req);
}
