import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import type {
	PiPromptInput,
	PiSessionPort,
	PiSessionState,
	PiSessionStats,
} from "../../apps/api/src/pi";
import type { RunModel } from "../../apps/api/src/run/ports";
import { executeRunOnce } from "../../apps/api/src/workflow/runonce";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";

class StubSession implements PiSessionPort {
	public promptInputs: PiPromptInput[] = [];
	public closed = false;

	async prompt(input: PiPromptInput): Promise<void> {
		this.promptInputs.push(input);
	}

	async steer(_message: string): Promise<void> {
		return;
	}

	async followUp(_message: string): Promise<void> {
		return;
	}

	async setQueueMode(): Promise<void> {
		return;
	}

	async abort(): Promise<void> {
		return;
	}

	async getState(): Promise<PiSessionState> {
		return {
			sessionFile: "/tmp/mock.session.jsonl",
			sessionId: "pi-session-1",
			isStreaming: false,
			pending: 0,
		};
	}

	async getLastAssistantText(): Promise<string> {
		return "done";
	}

	async getSessionStats(): Promise<PiSessionStats> {
		return { totalTokens: 2, costUsd: 0.001 };
	}

	drainPendingEvents(): Record<string, unknown>[] {
		return [];
	}

	async waitUntilIdle(options?: {
		onEvent?:
			| ((event: Record<string, unknown>) => Promise<void> | void)
			| undefined;
	}): Promise<void> {
		if (options?.onEvent) {
			await options.onEvent({ type: "agent_event", chunk: "ok" });
		}
	}

	async close(): Promise<void> {
		this.closed = true;
	}
}

function sampleRun(): RunModel {
	return {
		runId: RUN_ID,
		status: "running",
		spec: {
			runId: RUN_ID,
			scope: "team",
			userMsg: "hello",
			attachments: [{ sha256: "a".repeat(64) }, { sha256: "b".repeat(64) }],
			workdirRef: { sha256: "c".repeat(64) },
			modelPref: "gpt-5-codex",
		},
		createdAt: "2026-02-27T00:00:00.000Z",
		updatedAt: "2026-02-27T00:00:00.000Z",
		dbosWorkflowId: RUN_ID,
		piSessionId: null,
		piSessionFile: null,
		resultText: null,
		resultStats: null,
		error: null,
	};
}

describe("run pi adapter integration", () => {
	it("persists session artifact and marks run done with stats", async () => {
		const session = new StubSession();
		const linked: Array<{ sha: string; kind: string }> = [];
		const lifecycle: string[] = [];
		let donePayload: Record<string, unknown> | null = null;

		await executeRunOnce(
			RUN_ID,
			{
				runRepo: {
					getRun: async () => sampleRun(),
				},
				runService: {
					beginRun: async () => {
						lifecycle.push("run_started");
						return {
							eventId: 1,
							runId: RUN_ID,
							kind: "run_started",
							payload: {},
							createdAt: "2026-02-27T00:00:00.000Z",
						};
					},
					appendPiEvent: async () => {
						lifecycle.push("pi_event");
						return {
							eventId: 2,
							runId: RUN_ID,
							kind: "pi_event",
							payload: {},
							createdAt: "2026-02-27T00:00:00.000Z",
						};
					},
					appendArtifactWritten: async () => {
						lifecycle.push("artifact_written");
						return {
							eventId: 3,
							runId: RUN_ID,
							kind: "artifact_written",
							payload: {},
							createdAt: "2026-02-27T00:00:00.000Z",
						};
					},
					completeRun: async (_runId, payload) => {
						donePayload = payload;
						lifecycle.push("run_done");
						return sampleRun();
					},
					failRun: async () => {
						throw new Error("unexpected failRun");
					},
					linkArtifact: async (_runId, sha256, kind) => {
						linked.push({ sha: sha256, kind });
					},
				},
				artifactService: {
					getArtifactMeta: async (sha256) => ({
						sha256,
						uri: `s3://agentos/cas/${sha256}`,
						mime: sha256.startsWith("a") ? "image/png" : "text/plain",
						bytes: 4,
						createdAt: "2026-02-27T00:00:00.000Z",
						type: "raw",
						parents: [],
						meta: {},
					}),
					getArtifactBytes: async () => ({
						body: Readable.from(Buffer.from("png!", "utf8")),
						contentType: "image/png",
					}),
					putArtifact: async () => ({
						sha256: "c".repeat(64),
						uri: "s3://agentos/cas/cc/cccc",
						mime: "application/jsonl",
						bytes: 4,
						createdAt: "2026-02-27T00:00:00.000Z",
						type: "trace",
						parents: [],
						meta: {},
					}),
				},
				createPiSession: async (run) => {
					expect(run.spec.modelPref).toBe("gpt-5-codex");
					return session;
				},
				readFileBytes: async () => Buffer.from("line\n"),
			},
			{
				runStep: async (_name, fn) => fn(),
			},
		);

		expect(session.promptInputs[0]?.message).toContain("hello");
		expect(session.promptInputs[0]?.message).toContain("attachmentRefs");
		expect(session.promptInputs[0]?.message).toContain("workdirRef");
		expect(session.promptInputs[0]?.message).toContain("modelPref");
		expect(session.promptInputs[0]?.images).toHaveLength(1);
		expect(linked).toContainEqual({
			sha: "c".repeat(64),
			kind: "pi_session_jsonl",
		});
		expect(donePayload).toMatchObject({
			resultText: "done",
			stats: { totalTokens: 2, costUsd: 0.001 },
		});
		expect(lifecycle).toContain("run_started");
		expect(lifecycle).toContain("pi_event");
		expect(lifecycle).toContain("artifact_written");
		expect(lifecycle).toContain("run_done");
		expect(session.closed).toBe(true);
	});

	it("allows blank final text when artifacts still complete the run", async () => {
		const session = new StubSession();
		session.getLastAssistantText = async () => "";
		let completed = false;

		await executeRunOnce(
			RUN_ID,
			{
				runRepo: {
					getRun: async () => sampleRun(),
				},
				runService: {
					beginRun: async () => ({
						eventId: 1,
						runId: RUN_ID,
						kind: "run_started",
						payload: {},
						createdAt: "2026-02-27T00:00:00.000Z",
					}),
					appendPiEvent: async () => ({
						eventId: 2,
						runId: RUN_ID,
						kind: "pi_event",
						payload: {},
						createdAt: "2026-02-27T00:00:00.000Z",
					}),
					appendArtifactWritten: async () => ({
						eventId: 3,
						runId: RUN_ID,
						kind: "artifact_written",
						payload: {},
						createdAt: "2026-02-27T00:00:00.000Z",
					}),
					completeRun: async () => {
						completed = true;
						return sampleRun();
					},
					failRun: async () => {
						throw new Error("unexpected failRun");
					},
					linkArtifact: async () => undefined,
				},
				artifactService: {
					getArtifactMeta: async (sha256) => ({
						sha256,
						uri: `s3://agentos/cas/${sha256}`,
						mime: "text/plain",
						bytes: 4,
						createdAt: "2026-02-27T00:00:00.000Z",
						type: "raw",
						parents: [],
						meta: {},
					}),
					getArtifactBytes: async () => ({
						body: Readable.from(Buffer.from("txt", "utf8")),
						contentType: "text/plain",
					}),
					putArtifact: async () => ({
						sha256: "d".repeat(64),
						uri: "s3://agentos/cas/dd/dddd",
						mime: "application/jsonl",
						bytes: 4,
						createdAt: "2026-02-27T00:00:00.000Z",
						type: "trace",
						parents: [],
						meta: {},
					}),
				},
				createPiSession: async () => session,
				readFileBytes: async () => Buffer.from("line\n"),
			},
			{
				runStep: async (_name, fn) => fn(),
			},
		);

		expect(completed).toBe(true);
	});
});
