import { isSha256 } from "@forkloom/shared";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import multer from "multer";
import { HttpError, isHttpError } from "../errors";
import type { ArtifactType, PutArtifactInput } from "../ports";
import type { ArtifactService } from "../service";

const upload = multer({ storage: multer.memoryStorage() });

async function readRawBody(req: Request): Promise<Buffer> {
	const chunks: Uint8Array[] = [];
	for await (const chunk of req) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}
	return Buffer.concat(chunks);
}

function parseType(input: unknown): ArtifactType {
	if (typeof input !== "string") {
		return "raw";
	}
	const allowed: ArtifactType[] = ["raw", "md", "json", "trace", "other"];
	if (!allowed.includes(input as ArtifactType)) {
		throw new HttpError(400, "invalid artifact type");
	}
	return input as ArtifactType;
}

function parseMeta(input: unknown): Record<string, unknown> {
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

async function parseUpload(req: Request): Promise<PutArtifactInput> {
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
			type: parseType(req.body.type),
			meta: parseMeta(req.body.meta),
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
		type: parseType(req.query.type),
		meta: {},
		expectedSha256,
		force,
	};
}

function mapError(error: unknown): { status: number; message: string } {
	if (isHttpError(error)) {
		return { status: error.status, message: error.message };
	}
	if (error instanceof SyntaxError) {
		return { status: 400, message: error.message };
	}
	return { status: 500, message: "internal error" };
}

function asyncHandler(
	handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
	return (req: Request, res: Response, next: NextFunction): void => {
		handler(req, res, next).catch(next);
	};
}

function requireParam(
	value: string | string[] | undefined,
	name: string,
): string {
	if (typeof value !== "string") {
		throw new HttpError(400, `invalid route param: ${name}`);
	}
	return value;
}

export function buildApiRouter(service: ArtifactService) {
	const app = express();

	app.post(
		"/artifacts",
		upload.single("file"),
		asyncHandler(async (req, res) => {
			const upload = await parseUpload(req);
			const artifact = await service.putArtifact(upload);
			res.json(artifact);
		}),
	);

	app.get(
		"/artifacts/:sha256",
		asyncHandler(async (req, res) => {
			const result = await service.getArtifactBytes(
				requireParam(req.params.sha256, "sha256"),
			);
			res.setHeader(
				"content-type",
				result.contentType ?? "application/octet-stream",
			);
			result.body.pipe(res);
		}),
	);

	app.get(
		"/artifacts/:sha256/meta",
		asyncHandler(async (req, res) => {
			const artifact = await service.getArtifactMeta(
				requireParam(req.params.sha256, "sha256"),
			);
			res.json(artifact);
		}),
	);

	app.post(
		"/artifacts/:sha256/link",
		express.json({ limit: "1mb" }),
		asyncHandler(async (req, res) => {
			const payload = (req.body ?? {}) as {
				parent?: string;
				meta?: Record<string, unknown>;
			};
			const artifact = await service.linkArtifact(
				requireParam(req.params.sha256, "sha256"),
				payload.parent ?? null,
				payload.meta ?? {},
			);
			res.json(artifact);
		}),
	);

	app.use(
		(error: unknown, _req: Request, res: Response, _next: NextFunction) => {
			const mapped = mapError(error);
			res.status(mapped.status).json({ error: mapped.message });
		},
	);

	return app;
}
