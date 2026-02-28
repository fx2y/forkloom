import { validateActorByName } from "@forkloom/contracts";
import type { Request } from "express";
import type { ActorSpecModel, MailboxPostModel } from "../actor";
import { HttpError } from "../errors";
import { parseArtifactPointers } from "./contract-parsers";
import { parseEventReplayCursor } from "./event-stream";

function parseOptionalString(
	value: unknown,
	label: string,
): string | undefined {
	if (value == null) {
		return undefined;
	}
	if (typeof value !== "string") {
		throw new HttpError(400, `${label} must be a string`);
	}
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		throw new HttpError(400, `${label} must be a non-empty string`);
	}
	return trimmed;
}

function parseMetadata(input: unknown): Record<string, unknown> | undefined {
	if (input == null) {
		return undefined;
	}
	if (typeof input !== "object" || Array.isArray(input)) {
		throw new HttpError(400, "metadata must be an object");
	}
	return input as Record<string, unknown>;
}

export function parseActorCreatePayload(input: unknown): ActorSpecModel {
	const result = validateActorByName("ActorSpec", input);
	if (!result.valid) {
		throw new HttpError(
			400,
			`invalid actor payload: ${result.errors.join("; ")}`,
		);
	}
	const record = input as Record<string, unknown>;
	return {
		actorId: String(record.actorId),
		name: String(record.name).trim(),
		status: "idle",
		workspaceId: parseOptionalString(record.workspaceId, "workspaceId"),
		memRef: parseOptionalString(record.memRef, "memRef"),
	};
}

export function parseMailboxPostPayload(
	input: unknown,
): Omit<MailboxPostModel, "actorId"> {
	const result = validateActorByName("MailboxPost", input);
	if (!result.valid) {
		throw new HttpError(
			400,
			`invalid mailbox payload: ${result.errors.join("; ")}`,
		);
	}
	const record = input as Record<string, unknown>;
	return {
		kind: record.kind as MailboxPostModel["kind"],
		text: String(record.text),
		attachments: parseArtifactPointers(record.attachments),
		dedupeKey: parseOptionalString(record.dedupeKey, "dedupeKey"),
		metadata: parseMetadata(record.metadata),
	};
}

export function parseActorCursor(req: Request): {
	sinceEventId: number;
	limit: number;
} {
	return parseEventReplayCursor(req);
}
