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

describe("run truth route", () => {
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
			getTruthBundle: async (runId: string) => {
				if (runId !== RUN_ID) {
					return null;
				}
				return {
					run: {
						runId,
						status: "done",
						spec: {
							runId,
							scope: "team",
							userMsg: "truth",
							attachments: [],
							orgId: "org-1",
							writeTarget: "ws",
						},
						createdAt: "2026-03-01T00:00:00.000Z",
						updatedAt: "2026-03-01T00:00:01.000Z",
						dbosWorkflowId: `run:${runId}:1`,
						piSessionId: "pi-session-1",
						piSessionFile: "s3://forkloom/cas/aa/aaaaaaaa",
						resultText: "done",
						resultStats: {},
						error: null,
					},
					steps: [],
					links: [],
					artifacts: [],
					sessionIndex: null,
					stepPayloads: [],
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

	it("returns a truth bundle for known runs", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;
			const response = await fetch(`${base}/runs/${RUN_ID}/truth`, {
				headers: RUN_SCOPE_HEADERS,
			});
			expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			run: { runId: string; status: string };
		};
		expect(payload.run.runId).toBe(RUN_ID);
		expect(payload.run.status).toBe("done");
	});

	it("returns 404 when run is unknown", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;
			const response = await fetch(
				`${base}/runs/01HS7Z6E5R4W6NED8MH4D9Y6A1/truth`,
				{ headers: RUN_SCOPE_HEADERS },
			);
			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ error: "run not found" });
		});

		it("rejects run routes when scope headers are missing", async () => {
			const address = server.address();
			if (!address || typeof address === "string") {
				throw new Error("failed to bind test server");
			}
			const base = `http://127.0.0.1:${address.port}`;
			const response = await fetch(`${base}/runs/${RUN_ID}/truth`);
			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: "x-org-id header required" });
		});
	});
