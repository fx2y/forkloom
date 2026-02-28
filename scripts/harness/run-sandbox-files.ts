import { buildApiRouter } from "../../apps/api/src/http/routes";
import { writeJson } from "./live-support";

async function main(): Promise<void> {
	const runId = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
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
			getRunState: async () => ({
				runId,
				status: "awaiting_approval" as const,
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
		} as never,
	});
	const server = app.listen(0);

	try {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind harness server");
		}
		const base = `http://127.0.0.1:${address.port}`;
		const runState = (await (await fetch(`${base}/runs/${runId}`)).json()) as {
			status: string;
			preview: { profile: string };
			files: { entries: Array<{ path: string }> };
		};
		const files = (await (
			await fetch(`${base}/runs/${runId}/files`)
		).json()) as {
			workspaceRef?: { sha256: string };
			workspace_manifest: {
				entries: Array<{ path: string; bytes: number; sha256: string }>;
			};
		};

		await writeJson(".cache/test-int/run-sandbox-files.json", {
			runId,
			runState,
			files,
		});
	} finally {
		await new Promise<void>((resolveClose, rejectClose) => {
			server.close((error) => {
				if (error) {
					rejectClose(error);
					return;
				}
				resolveClose();
			});
		});
	}
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
