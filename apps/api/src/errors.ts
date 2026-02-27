export class HttpError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

export function isHttpError(error: unknown): error is HttpError {
	return (
		typeof error === "object" &&
		error !== null &&
		"status" in error &&
		typeof (error as { status: unknown }).status === "number"
	);
}
