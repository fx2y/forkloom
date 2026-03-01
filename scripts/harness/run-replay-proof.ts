import { buildApiRouter } from "../../apps/api/src/http/routes";
import { runReplayCheck } from "./run-replay";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
const ISO = "2026-02-28T00:00:00.000Z";

async function main(): Promise<void> {
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
			getTruthBundle: async () => ({
				run: {
					runId: RUN_ID,
					status: "done",
					spec: {
						runId: RUN_ID,
						scope: "team",
						userMsg: "replay test",
						attachments: [],
						profile: "safe",
					},
					createdAt: ISO,
					updatedAt: ISO,
					dbosWorkflowId: RUN_ID,
					piSessionId: "session-1",
					piSessionFile: "/tmp/session.jsonl",
					resultText: "done",
					resultStats: {},
					error: null,
				},
				steps: [
					{
						runId: RUN_ID,
						stepName: "run_command",
						attempt: 2,
						stepKey: "a".repeat(64),
						inHash: "b".repeat(64),
						outHash: "c".repeat(64),
						startedAt: ISO,
						endedAt: ISO,
					},
				],
				links: [
					{
						runId: RUN_ID,
						stepName: "run_command",
						attempt: 2,
						sessionEntryIds: ["entry-1"],
						artifactShas: ["a".repeat(64), "b".repeat(64), "c".repeat(64)],
						note: "step=run_command",
						createdAt: ISO,
					},
				],
				artifacts: [
					{
						runId: RUN_ID,
						sha256: "b".repeat(64),
						kind: "pi_session_jsonl",
						createdAt: ISO,
					},
				],
				sessionIndex: {
					runId: RUN_ID,
					entryCount: 1,
					rootId: "root",
					leafId: "leaf",
					summaryEntryCount: 0,
					updatedAt: ISO,
				},
				stepPayloads: [
					{
						runId: RUN_ID,
						stepName: "run_command",
						attempt: 2,
						payload: {
							commandSeq: 2,
							commandKind: "prompt",
							commandPayload: { text: "replay test" },
							exec: {
								exitCode: 0,
								status: "done",
								startedAt: ISO,
								endedAt: ISO,
								cmdList: ["prompt", "replay test"],
								artifactReads: [{ sha256: "a".repeat(64) }],
								artifactWrites: [
									{ sha256: "b".repeat(64) },
									{ sha256: "c".repeat(64) },
								],
							},
							session: {
								sessionId: "session-1",
								sessionFile: "/tmp/session.jsonl",
								sessionArtifactSha: "b".repeat(64),
								sessionEntryIds: ["entry-1"],
								entryCount: 1,
								rootId: "root",
								leafId: "leaf",
								summaryEntryCount: 0,
							},
						},
						createdAt: ISO,
					},
				],
			}),
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
		} as never,
	});
	const server = app.listen(0);

	try {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind harness server");
		}
		process.env.FORKLOOM_API_ORIGIN = `http://127.0.0.1:${address.port}`;
		await runReplayCheck({
			runId: RUN_ID,
			mode: "stub",
			outputPath: ".cache/spec06/replay-cli.assert.json",
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
