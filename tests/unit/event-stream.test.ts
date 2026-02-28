import type { Request } from "express";
import { describe, expect, it } from "vitest";
import {
	clampEventReplayLimit,
	parseEventReplayCursor,
} from "../../apps/api/src/http/event-stream";

function makeRequest(input: {
	headers?: Record<string, string>;
	query?: Record<string, string>;
}): Request {
	const headers = Object.fromEntries(
		Object.entries(input.headers ?? {}).map(([key, value]) => [
			key.toLowerCase(),
			value,
		]),
	);
	return {
		query: input.query ?? {},
		header: (name: string) => headers[name.toLowerCase()],
	} as unknown as Request;
}

describe("event-stream helpers", () => {
	it("clamps replay limits into the supported window", () => {
		expect(clampEventReplayLimit(undefined)).toBe(100);
		expect(clampEventReplayLimit(0)).toBe(1);
		expect(clampEventReplayLimit(25)).toBe(25);
		expect(clampEventReplayLimit(5000)).toBe(1000);
	});

	it("parses replay cursors from Last-Event-ID and query params", () => {
		expect(
			parseEventReplayCursor(
				makeRequest({
					headers: { "Last-Event-ID": "12" },
					query: { limit: "25" },
				}),
			),
		).toEqual({
			sinceEventId: 12,
			limit: 25,
		});
	});

	it("rejects malformed cursor values", () => {
		expect(() =>
			parseEventReplayCursor(
				makeRequest({ headers: { "Last-Event-ID": "oops" } }),
			),
		).toThrow("cursor must be a non-negative integer");
		expect(() =>
			parseEventReplayCursor(makeRequest({ query: { limit: "oops" } })),
		).toThrow("limit must be a non-negative integer");
	});
});
