import type { NextFunction, Request, Response } from "express";
import { isActorNotFoundError } from "../actor";
import { isHttpError } from "../errors";

export function mapError(error: unknown): { status: number; message: string } {
	if (isActorNotFoundError(error)) {
		return { status: 404, message: error.message };
	}
	if (isHttpError(error)) {
		return { status: error.status, message: error.message };
	}
	if (error instanceof SyntaxError) {
		return { status: 400, message: error.message };
	}
	return { status: 500, message: "internal error" };
}

export function asyncHandler(
	handler: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
	return (req: Request, res: Response, next: NextFunction): void => {
		handler(req, res, next).catch(next);
	};
}
