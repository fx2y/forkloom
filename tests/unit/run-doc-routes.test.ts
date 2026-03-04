import { afterAll, describe, expect, it } from "vitest";
import { buildApiRouter } from "../../apps/api/src/http/routes";
import { resolveScope } from "../../apps/api/src/http/scope";
import type { RunService } from "../../apps/api/src/run/service";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
const RUN_SCOPE_HEADERS = {
	"x-org-id": "00000000-0000-0000-0000-000000000001",
	"x-ws-id": "00000000-0000-0000-0000-000000000002",
	"x-write-scope": "ws",
} as const;

describe("run doc routes", () => {
	const app = buildApiRouter({
		artifactService: {
			putArtifact: async () => {
				throw new Error("unused");
			},
			getArtifactBytes: async () => {
				throw new Error("unused");
			},
			getArtifactMeta: async () => {
				throw new Error("unused");
			},
			linkArtifact: async () => {
				throw new Error("unused");
			},
		} as never,
		resolveScope,
		runService: {
			startRun: async () => {
				throw new Error("unused");
			},
			getRunState: async () => null,
			listRunEvents: async () => [],
			queueCommand: async () => {
				throw new Error("unused");
			},
			listFiles: async () => {
				throw new Error("unused");
			},
			exportFiles: async () => {
				throw new Error("unused");
			},
			getTruthBundle: async () => null,
			ingestDoc: async () => ({
				docSha: "f".repeat(64),
				parseId: "parse:ingest",
				status: "queued" as const,
			}),
			searchDocs: async () => ({
				query: "invoice total",
				scope: "*",
				hits: [
					{
						chunkId: "chunk:1",
						score: 1.25,
						snippet: "Invoice total is $19.99",
						spans: [
							{
								docSha: "a".repeat(64),
								parseId: "parse:1",
								page: 1,
								bbox: [0, 0, 100, 100],
								charStart: 0,
								charEnd: 12,
								blockPath: "p1/b1",
								chunkId: "chunk:1",
							},
						],
					},
				],
			}),
			resolveDocSpan: async ({ span }: { span: { chunkId: string } }) => {
				if (span.chunkId === "chunk:404") {
					return null;
				}
				return {
					span: {
						docSha: "a".repeat(64),
						parseId: "parse:1",
						page: 1,
						bbox: [0, 0, 100, 100],
						charStart: 0,
						charEnd: 12,
						blockPath: "p1/b1",
						chunkId: span.chunkId,
					},
					md: "Total: $19.99",
					bbox: [0, 0, 100, 100],
					pageImageSha: "b".repeat(64),
				};
			},
		} as unknown as RunService,
	});
	const server = app.listen(0);

	afterAll(async () => {
		await new Promise<void>((resolveClose, rejectClose) => {
			server.close((error) => {
				if (error) {
					rejectClose(error);
					return;
				}
				resolveClose();
			});
		});
	});

	it("serves cite-first run-owned doc search results", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;
			const response = await fetch(`${base}/runs/${RUN_ID}/doc/search`, {
				method: "POST",
				headers: {
					...RUN_SCOPE_HEADERS,
					"content-type": "application/json",
				},
				body: JSON.stringify({ query: "invoice total", scope: "*" }),
			});
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			hits: Array<{ spans: unknown[] }>;
		};
		expect(payload.hits[0]?.spans.length).toBe(1);
	});

	it("starts doc ingest via run-owned route", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;
			const response = await fetch(`${base}/runs/${RUN_ID}/doc/ingest`, {
				method: "POST",
				headers: {
					...RUN_SCOPE_HEADERS,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					mime: "application/pdf",
				bodyBase64: Buffer.from("pdf-bytes", "utf8").toString("base64"),
			}),
		});
		expect(response.status).toBe(202);
		const payload = (await response.json()) as {
			status: string;
			parseId: string;
		};
		expect(payload.status).toBe("queued");
		expect(payload.parseId).toBe("parse:ingest");
	});

	it("resolves persisted span references", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;
			const response = await fetch(`${base}/runs/${RUN_ID}/doc/resolve`, {
				method: "POST",
				headers: {
					...RUN_SCOPE_HEADERS,
					"content-type": "application/json",
				},
				body: JSON.stringify({
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
		});
		expect(response.status).toBe(200);
		const payload = (await response.json()) as { md: string };
		expect(payload.md).toContain("19.99");
	});

	it("returns 404 when span resolution misses", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;
			const response = await fetch(`${base}/runs/${RUN_ID}/doc/resolve`, {
				method: "POST",
				headers: {
					...RUN_SCOPE_HEADERS,
					"content-type": "application/json",
				},
				body: JSON.stringify({
					span: {
					docSha: "a".repeat(64),
					parseId: "parse:1",
					page: 1,
					bbox: [0, 0, 100, 100],
					charStart: 0,
					charEnd: 12,
					blockPath: "p1/b1",
					chunkId: "chunk:404",
				},
			}),
		});
		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({ error: "span not found" });
	});

	it("rejects invalid search payloads", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;
			const response = await fetch(`${base}/runs/${RUN_ID}/doc/search`, {
				method: "POST",
				headers: {
					...RUN_SCOPE_HEADERS,
					"content-type": "application/json",
				},
				body: JSON.stringify({ query: "  ", scope: "*" }),
			});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "doc search query is required",
		});
	});

	it("rejects invalid ingest payloads", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;
			const response = await fetch(`${base}/runs/${RUN_ID}/doc/ingest`, {
				method: "POST",
				headers: {
					...RUN_SCOPE_HEADERS,
					"content-type": "application/json",
				},
				body: JSON.stringify({ mime: "application/pdf" }),
			});
		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			error: "doc ingest bodyBase64 is required",
		});
	});
});
