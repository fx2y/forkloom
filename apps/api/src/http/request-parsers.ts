import { validateArtifactMeta } from "@forkloom/contracts";
import { isSha256 } from "@forkloom/shared";
import type { Request } from "express";
import { HttpError } from "../errors";
import type { ArtifactType, PutArtifactInput } from "../ports";
import type { RunScope, RunSpecModel } from "../run/ports";

async function readRawBody(req: Request): Promise<Buffer> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks);
}

export function parseArtifactType(input: unknown): ArtifactType {
	if (typeof input !== "string") {
		return "raw";
	}
	const allowed: ArtifactType[] = ["raw", "md", "json", "trace", "other"];
	if (!allowed.includes(input as ArtifactType)) {
		throw new HttpError(400, "invalid artifact type");
	}
	return input as ArtifactType;
}

function parseMetaObject(input: unknown): Record<string, unknown> {
	if (input == null || input === "") {
		return {};
	}
	if (typeof input === "string") {
		const parsed = JSON.parse(input) as unknown;
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
		throw new HttpError(400, "meta must be a JSON object");
	}
	if (typeof input === "object" && !Array.isArray(input)) {
		return input as Record<string, unknown>;
	}
	throw new HttpError(400, "meta must be a JSON object");
}

export function parseArtifactMeta(input: unknown): Record<string, unknown> {
	const parsed = parseMetaObject(input);
	const validation = validateArtifactMeta(parsed);
	if (!validation.valid) {
		throw new HttpError(400, `invalid meta: ${validation.errors.join("; ")}`);
	}
	return parsed;
}

export function parseLinkPayload(input: unknown): {
	parent: string | null;
	meta: Record<string, unknown>;
} {
	if (input == null) {
		return { parent: null, meta: {} };
	}
	if (typeof input !== "object" || Array.isArray(input)) {
		throw new HttpError(400, "link payload must be a JSON object");
	}

	const record = input as Record<string, unknown>;
	const parentValue = record.parent;
	if (parentValue != null && typeof parentValue !== "string") {
		throw new HttpError(400, "parent must be a string");
	}

	return {
		parent: parentValue ?? null,
		meta: parseArtifactMeta(record.meta),
	};
}

export async function parseUpload(req: Request): Promise<PutArtifactInput> {
	const expectedSha256 = req.header("x-sha256") ?? undefined;
	if (expectedSha256 && !isSha256(expectedSha256)) {
		throw new HttpError(400, "invalid x-sha256 header");
	}

	const force = req.query.force === "1";

	if (req.is("multipart/form-data")) {
		const body = req.file?.buffer;
		if (!body) {
			throw new HttpError(400, "multipart upload requires file field");
		}
		return {
			body,
			mime: req.file?.mimetype || "application/octet-stream",
			type: parseArtifactType(req.body.type),
			meta: parseArtifactMeta(req.body.meta),
			expectedSha256,
			force,
		};
	}

	const body = await readRawBody(req);
	if (!body.byteLength) {
		throw new HttpError(400, "raw upload body is empty");
	}

	return {
		body,
		mime: req.header("content-type") || "application/octet-stream",
		type: parseArtifactType(req.query.type),
		meta: {},
		expectedSha256,
		force,
	};
}

export function requireRouteParam(
	value: string | string[] | undefined,
	name: string,
): string {
	if (typeof value !== "string") {
		throw new HttpError(400, `invalid route param: ${name}`);
	}
	return value;
}

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
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		throw new HttpError(400, "run payload must be a JSON object");
	}
	const record = input as Record<string, unknown>;
	if (typeof record.runId !== "string" || record.runId.length === 0) {
		throw new HttpError(400, "runId is required");
	}
	if (
		typeof record.userMsg !== "string" ||
		record.userMsg.trim().length === 0
	) {
		throw new HttpError(400, "userMsg is required");
	}
	if (record.modelPref != null && typeof record.modelPref !== "string") {
		throw new HttpError(400, "modelPref must be a string");
	}
	const modelPref =
		typeof record.modelPref === "string" ? record.modelPref : undefined;
	const runId = record.runId;
	const userMsg = record.userMsg;

	return {
		runId,
		scope: parseRunScope(record.scope),
		userMsg: userMsg.trim(),
		attachments: parseAttachments(record.attachments),
		workdirRef:
			record.workdirRef == null
				? undefined
				: parseArtifactPointer(record.workdirRef, "workdirRef"),
		modelPref,
	};
}
