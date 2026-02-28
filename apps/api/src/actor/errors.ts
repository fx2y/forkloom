export class ActorNotFoundError extends Error {
	constructor(readonly actorId: string) {
		super(`actor not found: ${actorId}`);
	}
}

export class ActorTransientError extends Error {
	constructor(message: string, options?: { cause?: unknown | undefined }) {
		super(message);
		if (options?.cause !== undefined) {
			this.cause = options.cause;
		}
	}

	override cause?: unknown;
}

export function isActorNotFoundError(
	error: unknown,
): error is ActorNotFoundError {
	return error instanceof ActorNotFoundError;
}

export function isActorTransientError(
	error: unknown,
): error is ActorTransientError {
	return error instanceof ActorTransientError;
}

export function toActorTransientError(
	label: string,
	error: unknown,
): ActorTransientError {
	if (error instanceof ActorTransientError) {
		return error;
	}
	const message = error instanceof Error ? error.message : String(error);
	return new ActorTransientError(`${label}: ${message}`, { cause: error });
}

export function isRetryablePiError(error: unknown): boolean {
	if (error instanceof ActorTransientError) {
		return true;
	}
	const message = error instanceof Error ? error.message : String(error);
	return /(timed out|timeout|econnreset|epipe|broken pipe|socket hang up|connection reset|bootstrap|rpc|session.*exit|spawn)/i.test(
		message,
	);
}
