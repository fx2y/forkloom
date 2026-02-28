import type { Request } from "express";
import { describe, expect, it } from "vitest";
import {
	parseActorCreatePayload,
	parseActorCursor,
	parseMailboxPostPayload,
} from "../../apps/api/src/http/actor-request-parsers";

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

describe("actor-request-parsers", () => {
	it("parses actor create payloads through the contract validator", () => {
		expect(
			parseActorCreatePayload({
				actorId: "actor-1",
				name: " ops ",
				workspaceId: "ws-1",
			}),
		).toEqual({
			actorId: "actor-1",
			name: "ops",
			status: "idle",
			workspaceId: "ws-1",
			memRef: undefined,
		});
	});

	it("parses mailbox post payloads and reuses shared attachment parsing", () => {
		expect(
			parseMailboxPostPayload({
				kind: "followUp",
				text: "hello",
				attachments: [{ sha256: "a".repeat(64) }],
				dedupeKey: "msg-1",
				metadata: { source: "web" },
			}),
		).toEqual({
			kind: "followUp",
			text: "hello",
			attachments: [{ sha256: "a".repeat(64) }],
			dedupeKey: "msg-1",
			metadata: { source: "web" },
		});
	});

	it("parses actor event replay cursors", () => {
		expect(
			parseActorCursor(
				makeRequest({
					headers: { "Last-Event-ID": "5" },
					query: { limit: "20" },
				}),
			),
		).toEqual({
			sinceEventId: 5,
			limit: 20,
		});
	});
});
