import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { executeRunOnce } from "../../apps/api/src/workflow/runonce";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
const ISO = "2026-03-01T00:00:00.000Z";

describe("executeRunOnce step ledger", () => {
	it("records hash+payload ledger rows for each named step", async () => {
		const recorded: Array<{
			stepName: string;
			stepKey: string;
			inHash: string;
			outHash?: string | undefined;
			startedAt?: string | undefined;
			endedAt?: string | undefined;
			payload?: Record<string, unknown> | undefined;
		}> = [];

		await executeRunOnce(
			RUN_ID,
			{
				runRepo: {
					getRun: async () => ({
						runId: RUN_ID,
						status: "queued",
						spec: {
							runId: RUN_ID,
							scope: "team",
							userMsg: "ship",
							attachments: [],
						},
						createdAt: ISO,
						updatedAt: ISO,
						dbosWorkflowId: null,
						piSessionId: null,
						piSessionFile: null,
						resultText: null,
						resultStats: null,
						error: null,
					}),
				},
				runService: {
					appendArtifactWritten: async () => ({
						eventId: 1,
						runId: RUN_ID,
						kind: "artifact_written",
						payload: {},
						createdAt: ISO,
					}),
					appendPiEvent: async () => ({
						eventId: 2,
						runId: RUN_ID,
						kind: "pi_event",
						payload: {},
						createdAt: ISO,
					}),
					beginRun: async () => ({
						eventId: 3,
						runId: RUN_ID,
						kind: "run_started",
						payload: {},
						createdAt: ISO,
					}),
					completeRun: async () => null,
					failRun: async () => null,
					linkArtifact: async () => undefined,
					recordStepLedger: async (input) => {
						recorded.push(input);
					},
				},
				artifactService: {
					getArtifactBytes: async () => ({
						body: Readable.from(Buffer.from("")),
						contentType: "text/plain" as const,
					}),
					getArtifactMeta: async () => ({
						sha256: "a".repeat(64),
						uri: "s3://forkloom/cas/aa/aaaaaaaa",
						mime: "text/plain",
						bytes: 0,
						createdAt: ISO,
						type: "raw",
						parents: [],
						meta: {},
					}),
					putArtifact: async () => ({
						sha256: "a".repeat(64),
						uri: "s3://forkloom/cas/aa/aaaaaaaa",
						mime: "application/jsonl",
						bytes: 2,
						createdAt: ISO,
						type: "trace",
						parents: [],
						meta: {},
					}),
				},
				createPiSession: async () => ({
					prompt: async () => undefined,
					followUp: async () => undefined,
					steer: async () => undefined,
					setQueueMode: async () => undefined,
					abort: async () => undefined,
					waitUntilIdle: async (opts) => {
						if (opts?.onEvent) {
							await opts.onEvent({ type: "assistant", text: "ok" });
						}
					},
					getState: async () => ({
						sessionId: "pi-session-1",
						sessionFile: "/tmp/pi-session.jsonl",
						isStreaming: false,
						pending: 0,
					}),
					getLastAssistantText: async () => "done",
					getSessionStats: async () => ({}),
					drainPendingEvents: () => [],
					close: async () => undefined,
				}),
				readFileBytes: async () => Buffer.from("{}"),
			},
			{
				runStep: async (_name, fn) => fn(),
			},
		);

		expect(recorded.map((entry) => entry.stepName)).toEqual([
			"initRun",
			"stageInputs",
			"startPi",
			"promptPi",
			"pumpEvents",
			"finalize",
			"persistSession",
			"markDone",
		]);
		for (const entry of recorded) {
			expect(entry.stepKey).toHaveLength(64);
			expect(entry.inHash).toHaveLength(64);
			expect(entry.outHash).toHaveLength(64);
			expect(entry.startedAt).toBeTypeOf("string");
			expect(entry.endedAt).toBeTypeOf("string");
			expect(entry.payload).toBeTypeOf("object");
		}
	});
});
