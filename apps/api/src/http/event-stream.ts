import type { Request } from "express";
import { HttpError } from "../errors";

type EventReplayCursor = {
	sinceEventId: number;
	limit: number;
};

type EventReplayCursorOptions = {
	defaultLimit?: number | undefined;
	maxLimit?: number | undefined;
};

function parseNonNegativeInteger(
	input: string | undefined,
	label: string,
): number | undefined {
	if (input == null || input === "") {
		return undefined;
	}
	if (!/^\d+$/.test(input)) {
		throw new HttpError(400, `${label} must be a non-negative integer`);
	}
	return Number(input);
}

export function clampEventReplayLimit(
	input: number | undefined,
	options: EventReplayCursorOptions = {},
): number {
	const defaultLimit = options.defaultLimit ?? 100;
	const maxLimit = options.maxLimit ?? 1000;
	if (input == null) {
		return defaultLimit;
	}
	return Math.max(1, Math.min(input, maxLimit));
}

export function parseEventReplayCursor(
	req: Request,
	options: EventReplayCursorOptions = {},
): EventReplayCursor {
	const since =
		parseNonNegativeInteger(
			req.header("last-event-id") ?? String(req.query.since ?? ""),
			"cursor",
		) ?? 0;
	const rawLimit = parseNonNegativeInteger(
		typeof req.query.limit === "string" ? req.query.limit : undefined,
		"limit",
	);

	return {
		sinceEventId: since,
		limit: clampEventReplayLimit(rawLimit, options),
	};
}
