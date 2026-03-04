import { afterAll, describe, expect, it } from "vitest";
import { buildApiRouter } from "../../apps/api/src/http/routes";
import { resolveScope } from "../../apps/api/src/http/scope";
import type { RunService } from "../../apps/api/src/run/service";

const RUN_SCOPE_HEADERS = {
	"x-org-id": "00000000-0000-0000-0000-000000000001",
	"x-ws-id": "00000000-0000-0000-0000-000000000002",
	"x-write-scope": "ws",
} as const;

describe("run files route", () => {
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
			getRunState: async (runId: string) => ({
				runId,
				status: "awaiting_approval",
				startedAt: "2026-02-28T00:00:00.000Z",
				dbosWfId: runId,
				preview: {
					imageDigest: "node:24-alpine",
					profile: "priv",
					network: "egress",
					workdir: "/work",
					timeoutSec: 900,
					maxBytesOut: 1024,
					mounts: [],
				},
				approval: { required: true, state: "pending" },
				currentCommand: { seq: 1, kind: "prompt", state: "queued" },
				files: {
					workspaceRef: { sha256: "a".repeat(64) },
					entries: [
						{
							path: "project/proof.txt",
							bytes: 12,
							sha256: "b".repeat(64),
						},
					],
				},
				artifacts: [],
			}),
			listRunEvents: async () => [],
			queueCommand: async () => {
				throw new Error("unused");
			},
			listFiles: async () => ({
				workspaceRef: { sha256: "a".repeat(64) },
				workspace_manifest: {
					version: 1 as const,
					entries: [
						{
							path: "project/proof.txt",
							bytes: 12,
							sha256: "b".repeat(64),
						},
					],
				},
			}),
			exportFiles: async () => {
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

	it("serves durable file listings from the persisted workspace manifest", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;

			const runResponse = await fetch(
				`${base}/runs/01HS7Z6E5R4W6NED8MH4D9Y6A0`,
				{ headers: RUN_SCOPE_HEADERS },
			);
		expect(runResponse.status).toBe(200);
		const runPayload = (await runResponse.json()) as {
			status: string;
			files: { entries: Array<{ path: string }> };
		};
		expect(runPayload.status).toBe("awaiting_approval");
		expect(runPayload.files.entries[0]?.path).toBe("project/proof.txt");

			const filesResponse = await fetch(
				`${base}/runs/01HS7Z6E5R4W6NED8MH4D9Y6A0/files`,
				{ headers: RUN_SCOPE_HEADERS },
			);
		expect(filesResponse.status).toBe(200);
		const payload = (await filesResponse.json()) as {
			workspaceRef?: { sha256: string };
			workspace_manifest: { entries: Array<{ path: string; bytes: number }> };
		};

		expect(payload.workspaceRef?.sha256).toBe("a".repeat(64));
		expect(payload.workspace_manifest.entries).toEqual([
			{ path: "project/proof.txt", bytes: 12, sha256: "b".repeat(64) },
		]);
	});
});
