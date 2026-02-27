import type { Request } from "express";
import { describe, expect, it } from "vitest";
import {
	parseArtifactMeta,
	parseArtifactType,
	parseLinkPayload,
	parseRunCreatePayload,
	parseUpload,
	requireRouteParam,
} from "../../apps/api/src/http/request-parsers";

function makeRawRequest(input: {
	body: Buffer;
	contentType?: string;
	query?: Record<string, string>;
	headers?: Record<string, string>;
}): Request {
	const headers: Record<string, string> = {
		"content-type": input.contentType ?? "application/octet-stream",
		...(input.headers ?? {}),
	};
	const req = {
		query: input.query ?? {},
		header: (name: string) => headers[name.toLowerCase()],
		is: () => false,
		[Symbol.asyncIterator]: async function* () {
			yield input.body;
		},
	} as unknown;
	return req as Request;
}

describe("request-parsers", () => {
	it("parses raw upload request", async () => {
		const upload = await parseUpload(
			makeRawRequest({
				body: Buffer.from("abc"),
				contentType: "text/plain",
				query: { type: "raw", force: "1" },
				headers: {
					"x-sha256":
						"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
				},
			}),
		);
		expect(upload.body.toString("utf8")).toBe("abc");
		expect(upload.force).toBe(true);
		expect(upload.type).toBe("raw");
	});

	it("parses multipart fields and validates meta keys", async () => {
		const req = {
			query: {},
			header: () => undefined,
			is: (type: string) => type === "multipart/form-data",
			file: { buffer: Buffer.from("x"), mimetype: "text/plain" },
			body: { type: "md", meta: '{"ingest.note":"ok"}' },
		} as unknown as Request;
		const upload = await parseUpload(req);
		expect(upload.type).toBe("md");
		expect(upload.meta["ingest.note"]).toBe("ok");
	});

	it("rejects bad artifact type and bad route param", () => {
		expect(() => parseArtifactType("bad")).toThrow("invalid artifact type");
		expect(() => requireRouteParam(["x"], "sha256")).toThrow(
			"invalid route param: sha256",
		);
	});

	it("rejects invalid meta key and malformed link payload", () => {
		expect(() => parseArtifactMeta({ BadKey: 1 })).toThrow("invalid meta:");
		expect(() => parseLinkPayload({ parent: 1 })).toThrow(
			"parent must be a string",
		);
	});

	it("parses run create payload and validates pointers", () => {
		const payload = parseRunCreatePayload({
			runId: "01HS7Z6E5R4W6NED8MH4D9Y6A0",
			scope: "team",
			userMsg: "hello",
			attachments: [{ sha256: "a".repeat(64) }],
			workdirRef: { sha256: "b".repeat(64) },
			modelPref: "gpt-4.1",
		});

		expect(payload.scope).toBe("team");
		expect(payload.attachments[0]?.sha256).toBe("a".repeat(64));
		expect(payload.workdirRef?.sha256).toBe("b".repeat(64));
		expect(payload.modelPref).toBe("gpt-4.1");
	});
});
