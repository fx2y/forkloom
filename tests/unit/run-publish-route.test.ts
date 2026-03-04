import { afterAll, describe, expect, it } from "vitest";
import { buildApiRouter } from "../../apps/api/src/http/routes";
import type { RunService } from "../../apps/api/src/run/service";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";

describe("run publish route", () => {
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
		runService: {
			startRun: async () => {
				throw new Error("unused");
			},
			getRunState: async () => null,
			listRunEvents: async () => [],
			queueCommand: async () => {
				throw new Error("unused");
			},
			publishObject: async (input: {
				runId: string;
				kind: string;
				key: string;
				scope: "me" | "team" | "org";
				writeTarget: "org" | "ws" | "member";
				publishTarget: "org" | "ws" | "member";
			}) => ({
				sha: "a".repeat(64),
				fromTarget: input.writeTarget,
				publishTarget: input.publishTarget,
				workflowID: `publish:${input.runId}`,
			}),
			listSkills: async () => {
				throw new Error("unused");
			},
			previewSkill: async () => {
				throw new Error("unused");
			},
			listFiles: async () => {
				throw new Error("unused");
			},
			exportFiles: async () => {
				throw new Error("unused");
			},
			getTruthBundle: async () => null,
			searchDocs: async () => {
				throw new Error("unused");
			},
			resolveDocSpan: async () => null,
			ingestDoc: async () => {
				throw new Error("unused");
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

	it("accepts run-owned publish at /runs/:runId/publish", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;
		const response = await fetch(`${base}/runs/${RUN_ID}/publish`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				kind: "policy",
				key: "policy/default",
				scope: "team",
				writeTarget: "ws",
				publishTarget: "org",
			}),
		});

		expect(response.status).toBe(202);
		expect(await response.json()).toEqual({
			sha: "a".repeat(64),
			fromTarget: "ws",
			publishTarget: "org",
			workflowID: `publish:${RUN_ID}`,
		});
	});
});
