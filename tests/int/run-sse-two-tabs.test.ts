import { afterAll, describe, expect, it } from "vitest";
import { buildApiRouter } from "../../apps/api/src/http/routes";
import type {
	RunArtifactLinkModel,
	RunEventModel,
	RunModel,
	RunRepo,
	RunSpecModel,
} from "../../apps/api/src/run/ports";
import { RunService } from "../../apps/api/src/run/service";
import { ArtifactService } from "../../apps/api/src/service";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
const SESSION_SHA = "c".repeat(64);

type SseStream = {
	abort(): void;
	readEvents(expectedCount: number): Promise<
		Array<{
			runId: string;
			seq: number;
			t: string;
			kind: string;
			payload: Record<string, unknown>;
		}>
	>;
};

class InMemoryRunRepo implements RunRepo {
	private readonly runs = new Map<string, RunModel>();
	private readonly events: RunEventModel[] = [];
	private readonly artifacts: RunArtifactLinkModel[] = [];
	private nextEventId = 1;

	async createRun(input: {
		runId: string;
		workflowId: string;
		spec: RunSpecModel;
	}): Promise<{ run: RunModel; created: boolean }> {
		const existing = this.runs.get(input.runId);
		if (existing) {
			return { run: existing, created: false };
		}

		const run: RunModel = {
			runId: input.runId,
			status: "running",
			spec: input.spec,
			createdAt: "2026-02-27T00:00:00.000Z",
			updatedAt: "2026-02-27T00:00:00.000Z",
			dbosWorkflowId: input.workflowId,
			piSessionId: null,
			piSessionFile: null,
			resultText: null,
			resultStats: {},
			error: null,
		};
		this.runs.set(input.runId, run);
		return { run, created: true };
	}

	async getRun(runId: string): Promise<RunModel | null> {
		return this.runs.get(runId) ?? null;
	}

	async appendEvent(input: {
		runId: string;
		kind: RunEventModel["kind"];
		payload: Record<string, unknown>;
	}): Promise<RunEventModel> {
		const event: RunEventModel = {
			eventId: this.nextEventId++,
			runId: input.runId,
			kind: input.kind,
			payload: input.payload,
			createdAt: `2026-02-27T00:00:0${this.nextEventId}.000Z`,
		};
		this.events.push(event);
		return event;
	}

	async listEventsSince(
		runId: string,
		sinceEventId: number,
		limit: number,
	): Promise<RunEventModel[]> {
		return this.events
			.filter((event) => event.runId === runId && event.eventId > sinceEventId)
			.slice(0, limit);
	}

	async listArtifacts(runId: string): Promise<RunArtifactLinkModel[]> {
		return this.artifacts.filter((artifact) => artifact.runId === runId);
	}

	async markDone(input: {
		runId: string;
		resultText: string;
		resultStats: Record<string, unknown>;
		piSessionId?: string | undefined;
		piSessionFile?: string | undefined;
	}): Promise<RunModel | null> {
		const run = this.runs.get(input.runId);
		if (!run) {
			return null;
		}
		const updated: RunModel = {
			...run,
			status: "done",
			updatedAt: "2026-02-27T00:00:09.000Z",
			resultText: input.resultText,
			resultStats: input.resultStats,
			piSessionId: input.piSessionId ?? null,
			piSessionFile: input.piSessionFile ?? null,
		};
		this.runs.set(input.runId, updated);
		return updated;
	}

	async markFailed(runId: string, error: string): Promise<RunModel | null> {
		const run = this.runs.get(runId);
		if (!run) {
			return null;
		}
		const updated: RunModel = {
			...run,
			status: "failed",
			error,
			updatedAt: "2026-02-27T00:00:09.000Z",
		};
		this.runs.set(runId, updated);
		return updated;
	}

	async linkArtifact(input: {
		runId: string;
		sha256: string;
		kind: string;
	}): Promise<void> {
		const exists = this.artifacts.some(
			(artifact) =>
				artifact.runId === input.runId &&
				artifact.sha256 === input.sha256 &&
				artifact.kind === input.kind,
		);
		if (exists) {
			return;
		}
		this.artifacts.push({
			runId: input.runId,
			sha256: input.sha256,
			kind: input.kind,
			createdAt: "2026-02-27T00:00:05.000Z",
		});
	}
}

async function openSseStream(
	url: string,
	headers: Record<string, string> = {},
): Promise<SseStream> {
	const controller = new AbortController();
	const response = await fetch(url, {
		headers,
		signal: controller.signal,
	});
	if (!response.body) {
		throw new Error("missing SSE body");
	}
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	return {
		abort() {
			controller.abort();
		},
		async readEvents(expectedCount: number) {
			const events: Array<{
				runId: string;
				seq: number;
				t: string;
				kind: string;
				payload: Record<string, unknown>;
			}> = [];

			while (events.length < expectedCount) {
				const chunk = await Promise.race([
					reader.read(),
					new Promise<never>((_, reject) => {
						setTimeout(
							() => reject(new Error("timed out waiting for SSE")),
							2000,
						);
					}),
				]);

				if (chunk.done) {
					break;
				}

				buffer += decoder.decode(chunk.value, { stream: true });
				let boundary = buffer.indexOf("\n\n");
				while (boundary !== -1) {
					const raw = buffer.slice(0, boundary);
					buffer = buffer.slice(boundary + 2);
					const parsed = parseSseBlock(raw);
					if (parsed?.event && parsed.event !== "gap" && parsed.data) {
						events.push(
							JSON.parse(parsed.data) as {
								runId: string;
								seq: number;
								t: string;
								kind: string;
								payload: Record<string, unknown>;
							},
						);
					}
					boundary = buffer.indexOf("\n\n");
				}
			}

			return events;
		},
	};
}

function parseSseBlock(
	block: string,
): { event?: string | undefined; data?: string | undefined } | null {
	if (block.startsWith(":")) {
		return null;
	}
	const lines = block.split("\n");
	let event: string | undefined;
	let data: string | undefined;
	for (const line of lines) {
		if (line.startsWith("event: ")) {
			event = line.slice("event: ".length);
		}
		if (line.startsWith("data: ")) {
			data = line.slice("data: ".length);
		}
	}
	return { event, data };
}

describe("run SSE two-tab replay", () => {
	const launches: string[] = [];
	const runRepo = new InMemoryRunRepo();
	const runService = new RunService({
		runRepo,
		workflowLauncher: {
			startRunOnce: async (runId) => {
				launches.push(runId);
			},
		},
	});
	const artifactService = new ArtifactService({
		repo: {
			ping: async () => true,
			getBySha256: async () => null,
			insertIfAbsent: async () => {
				throw new Error("unused");
			},
			deleteBySha256: async () => undefined,
			appendLink: async () => null,
		},
		store: {
			ensureBucket: async () => undefined,
			putObject: async () => undefined,
			getObject: async () => {
				throw new Error("unused");
			},
			ping: async () => true,
		},
		s3Bucket: "agentos",
	});
	const app = buildApiRouter({ artifactService, runService });
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

	it("streams the same events to two tabs and replays from Last-Event-ID", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;

		const created = await fetch(`${base}/runs`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				runId: RUN_ID,
				scope: "team",
				userMsg: "hello",
				attachments: [],
			}),
		});
		expect(created.status).toBe(201);
		expect(launches).toEqual([RUN_ID]);

		const tab1 = await openSseStream(`${base}/runs/${RUN_ID}/events`);
		const tab2 = await openSseStream(`${base}/runs/${RUN_ID}/events`);

		await runService.appendRunStarted(RUN_ID, {});
		await runService.appendPiEvent(RUN_ID, { chunk: "hello" });

		const tab1First = await tab1.readEvents(2);
		const tab2First = await tab2.readEvents(2);
		expect(tab1First.map((event) => event.seq)).toEqual([1, 2]);
		expect(tab2First.map((event) => event.seq)).toEqual([1, 2]);
		expect(tab1First.map((event) => event.kind)).toEqual([
			"run_started",
			"pi_event",
		]);
		expect(tab2First).toEqual(tab1First);

		tab2.abort();

		await runService.linkArtifact(RUN_ID, SESSION_SHA, "pi_session_jsonl");
		await runService.appendArtifactWritten(RUN_ID, {
			sha256: SESSION_SHA,
			kind: "pi_session_jsonl",
		});

		const replay = await openSseStream(`${base}/runs/${RUN_ID}/events`, {
			"Last-Event-ID": "2",
		});
		await runService.completeRun(RUN_ID, {
			resultText: "done",
			stats: { totalTokens: 3, costUsd: 0.002 },
			artifacts: [SESSION_SHA],
			piSessionId: "pi-session-1",
			piSessionFile: "s3://agentos/cas/cc/cccc",
		});

		const tab1Rest = await tab1.readEvents(2);
		const replayRest = await replay.readEvents(2);

		expect(tab1Rest.map((event) => event.seq)).toEqual([3, 4]);
		expect(replayRest.map((event) => event.seq)).toEqual([3, 4]);
		expect(replayRest.map((event) => event.kind)).toEqual([
			"artifact_written",
			"run_done",
		]);

		const runStateResponse = await fetch(`${base}/runs/${RUN_ID}`);
		expect(runStateResponse.status).toBe(200);
		const runState = (await runStateResponse.json()) as {
			status: string;
			dbosWfId: string;
			artifacts: Array<{ sha256: string }>;
		};
		expect(runState.status).toBe("done");
		expect(runState.dbosWfId).toBe(RUN_ID);
		expect(runState.artifacts).toEqual([{ sha256: SESSION_SHA }]);

		tab1.abort();
		replay.abort();
	});
});
