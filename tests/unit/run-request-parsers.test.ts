import type { Request } from "express";
import { describe, expect, it } from "vitest";
import {
	RUN_SKILL_TEXT_COMMAND_KINDS,
	RUN_SKILL_TEXT_COMMAND_PREFIX,
	parseRunCommandPayload,
	parseRunCreatePayload,
	parseRunCursor,
	parseRunDocIngestPayload,
	parseRunDocResolvePayload,
	parseRunDocSearchPayload,
	parseRunFileExportPayload,
	parseRunSkillPreviewPayload,
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

	it("accepts profile as part of the v1 run contract", () => {
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
		expect(RUN_SKILL_TEXT_COMMAND_PREFIX).toBe("/skill:");
		expect(RUN_SKILL_TEXT_COMMAND_KINDS).toEqual([
			"prompt",
			"followUp",
			"steer",
		]);
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
		expect(() => parseRunCommandPayload({ kind: "skill" })).toThrow(
			"kind must be one of",
		);
		expect(() =>
			parseRunCommandPayload({ kind: "prompt", payload: {} }),
		).toThrow("prompt payload.text is required");
	});

	it("parses /skill invocations in text command payloads", () => {
		expect(
			parseRunCommandPayload({
				kind: "prompt",
				payload: { text: "/skill:policy-qa summarize controls" },
			}),
		).toEqual({
			kind: "prompt",
			payload: { text: "/skill:policy-qa summarize controls" },
			dedupeKey: undefined,
		});
		expect(() =>
			parseRunCommandPayload({
				kind: "prompt",
				payload: { text: "/skill:Policy bad" },
			}),
		).toThrow("invalid /skill invocation");
	});

	it("parses file export payloads and rejects malformed paths", () => {
		expect(parseRunFileExportPayload(undefined)).toEqual({});
		expect(
			parseRunFileExportPayload({
				paths: ["project/a.ts", "out/result.txt"],
			}),
		).toEqual({
			paths: ["project/a.ts", "out/result.txt"],
		});
		expect(() => parseRunFileExportPayload({ paths: ["", 1] })).toThrow(
			"paths must be a non-empty string array",
		);
	});

	it("parses skill preview payload and validates shape", () => {
		expect(
			parseRunSkillPreviewPayload({
				skillName: "policy-qa",
				args: "invoice.pdf",
			}),
		).toEqual({
			skillName: "policy-qa",
			args: "invoice.pdf",
		});
		expect(() => parseRunSkillPreviewPayload({})).toThrow(
			"skillName is required",
		);
		expect(() =>
			parseRunSkillPreviewPayload({
				skillName: "Policy-QA",
			}),
		).toThrow("skillName must match");
	});

	it("parses doc search payload and clamps invalid limits", () => {
		expect(
			parseRunDocSearchPayload({
				query: "invoice total",
				scope: "doc:".concat("a".repeat(64)),
				limit: 12,
			}),
		).toEqual({
			query: "invoice total",
			scope: "doc:".concat("a".repeat(64)),
			limit: 12,
		});
		expect(
			parseRunDocSearchPayload({
				query: "invoice",
			}),
		).toEqual({
			query: "invoice",
			scope: "*",
			limit: undefined,
		});
		expect(() => parseRunDocSearchPayload({ query: "", limit: 3 })).toThrow(
			"doc search query is required",
		);
		expect(() => parseRunDocSearchPayload({ query: "q", limit: 0 })).toThrow(
			"search limit must be in [1,100]",
		);
	});

	it("parses doc resolve payload with SpanRef validation", () => {
		expect(
			parseRunDocResolvePayload({
				span: {
					docSha: "a".repeat(64),
					parseId: "parse:1",
					page: 1,
					bbox: [0, 0, 100, 100],
					charStart: 0,
					charEnd: 12,
					blockPath: "p1/b1",
					chunkId: "chunk:1",
				},
			}),
		).toEqual({
			docSha: "a".repeat(64),
			parseId: "parse:1",
			page: 1,
			bbox: [0, 0, 100, 100],
			charStart: 0,
			charEnd: 12,
			blockPath: "p1/b1",
			chunkId: "chunk:1",
		});
		expect(() => parseRunDocResolvePayload({ span: { page: 1 } })).toThrow(
			"invalid span payload:",
		);
	});

	it("parses doc ingest payload and rejects invalid base64 payloads", () => {
		const payload = parseRunDocIngestPayload({
			mime: "application/pdf",
			bodyBase64: Buffer.from("pdf-bytes", "utf8").toString("base64"),
		});
		expect(payload.mime).toBe("application/pdf");
		expect(payload.body.toString("utf8")).toBe("pdf-bytes");
		expect(() => parseRunDocIngestPayload({ mime: "application/pdf" })).toThrow(
			"doc ingest bodyBase64 is required",
		);
		expect(() =>
			parseRunDocIngestPayload({
				mime: "",
				bodyBase64: "AA==",
			}),
		).toThrow("doc ingest mime is required");
	});
});
