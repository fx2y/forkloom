import type { Request } from "express";
import { describe, expect, it } from "vitest";
import {
	parseRunCommandPayload,
	parseRunCreatePayload,
	parseRunCursor,
} from "../../apps/api/src/http/run-request-parsers";

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

describe("run-request-parsers", () => {
	it("parses run create payload with contract validation", () => {
		const payload = parseRunCreatePayload({
			runId: "01HS7Z6E5R4W6NED8MH4D9Y6A0",
			scope: "team",
			userMsg: " hello ",
			attachments: [{ sha256: "a".repeat(64) }],
			workdirRef: { sha256: "b".repeat(64) },
			modelPref: "gpt-4.1",
		});

		expect(payload.userMsg).toBe("hello");
		expect(payload.attachments[0]?.sha256).toBe("a".repeat(64));
		expect(payload.workdirRef?.sha256).toBe("b".repeat(64));
	});

	it("accepts an additive sandbox profile outside the frozen contract body", () => {
		const payload = parseRunCreatePayload({
			runId: "01HS7Z6E5R4W6NED8MH4D9Y6A0",
			scope: "team",
			userMsg: "hello",
			attachments: [],
			profile: "safe",
		});

		expect(payload.profile).toBe("safe");
	});

	it("rejects invalid run payloads", () => {
		expect(() =>
			parseRunCreatePayload({
				runId: "bad",
				scope: "team",
				userMsg: "hello",
				attachments: [],
			}),
		).toThrow("invalid run payload:");
		expect(() =>
			parseRunCreatePayload({
				runId: "01HS7Z6E5R4W6NED8MH4D9Y6A0",
				scope: "team",
				userMsg: "   ",
				attachments: [],
			}),
		).toThrow("userMsg is required");
	});

	it("parses Last-Event-ID and limit cursor inputs", () => {
		const cursor = parseRunCursor(
			makeRequest({
				headers: { "Last-Event-ID": "12" },
				query: { limit: "25" },
			}),
		);

		expect(cursor).toEqual({ sinceEventId: 12, limit: 25 });
	});

	it("falls back to query cursor and rejects malformed integers", () => {
		expect(parseRunCursor(makeRequest({ query: { since: "7" } }))).toEqual({
			sinceEventId: 7,
			limit: 100,
		});
		expect(() =>
			parseRunCursor(makeRequest({ headers: { "Last-Event-ID": "abc" } })),
		).toThrow("cursor must be a non-negative integer");
	});

	it("parses command posts and rejects bad kinds", () => {
		expect(
			parseRunCommandPayload({
				kind: "followUp",
				payload: { text: "continue" },
				dedupeKey: "abc",
			}),
		).toEqual({
			kind: "followUp",
			payload: { text: "continue" },
			dedupeKey: "abc",
		});
		expect(() => parseRunCommandPayload({ kind: "nope" })).toThrow(
			"kind must be one of",
		);
	});
});
