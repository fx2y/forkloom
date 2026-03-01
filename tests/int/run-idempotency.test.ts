import { describe, expect, it } from "vitest";
import { buildApiRouter } from "../../apps/api/src/http/routes";
import type {
	RunEventModel,
	RunModel,
	RunRepo,
	RunSpecModel,
} from "../../apps/api/src/run/ports";
import { RunService } from "../../apps/api/src/run/service";
import { ArtifactService } from "../../apps/api/src/service";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";

function makeRun(
	spec: RunSpecModel,
	overrides: Partial<RunModel> = {},
): RunModel {
	return {
		runId: spec.runId,
		status: "queued",
		spec,
		createdAt: "2026-02-27T00:00:00.000Z",
		updatedAt: "2026-02-27T00:00:00.000Z",
		dbosWorkflowId: null,
		piSessionId: null,
		piSessionFile: null,
		resultText: null,
		resultStats: null,
		error: null,
		...overrides,
	};
}

class InMemoryRunRepo implements RunRepo {
	private run: RunModel | null = null;
	private nextEventId = 1;

	async createRun({
		spec,
	}: {
		runId: string;
		spec: RunSpecModel;
	}): Promise<{ run: RunModel; created: boolean }> {
		if (!this.run) {
			this.run = makeRun(spec);
			return { run: this.run, created: true };
		}
		return { run: this.run, created: false };
	}

	async recordWorkflowLaunch(
		runId: string,
		workflowId: string,
	): Promise<RunModel | null> {
		if (!this.run || this.run.runId !== runId) {
			return null;
		}
		this.run = {
			...this.run,
			dbosWorkflowId: workflowId,
		};
		return this.run;
	}

	async beginRun(input: {
		runId: string;
		workflowId: string;
		payload: Record<string, unknown>;
	}): Promise<RunEventModel> {
		if (!this.run || this.run.runId !== input.runId) {
			throw new Error("run not found");
		}
		this.run = {
			...this.run,
			status: "running",
			dbosWorkflowId: input.workflowId,
		};
		return {
			eventId: this.nextEventId++,
			runId: input.runId,
			kind: "run_started",
			payload: input.payload,
			createdAt: "2026-02-27T00:00:00.000Z",
		};
	}

	async getRun(runId: string): Promise<RunModel | null> {
		return this.run?.runId === runId ? this.run : null;
	}

	async appendEvent(): Promise<RunEventModel> {
		throw new Error("unused");
	}

	async listEventsSince(): Promise<RunEventModel[]> {
		throw new Error("unused");
	}

	async listArtifacts(): Promise<[]> {
		return [];
	}

	async createStep(): Promise<never> {
		throw new Error("unused");
	}

	async upsertLink(): Promise<never> {
		throw new Error("unused");
	}

	async upsertSessionIndex(): Promise<never> {
		throw new Error("unused");
	}

	async upsertStepPayload(): Promise<never> {
		throw new Error("unused");
	}

	async recordStepLedger(): Promise<void> {
		throw new Error("unused");
	}

	async listSteps(): Promise<[]> {
		return [];
	}

	async listLinks(): Promise<[]> {
		return [];
	}

	async listStepPayloads(): Promise<[]> {
		return [];
	}

	async getTruthBundle(): Promise<null> {
		return null;
	}

	async completeRun(): Promise<{
		run: RunModel | null;
		event: RunEventModel | null;
	}> {
		return { run: this.run, event: null };
	}

	async failRun(): Promise<{
		run: RunModel | null;
		event: RunEventModel | null;
	}> {
		return { run: this.run, event: null };
	}

	async linkArtifact(): Promise<void> {
		return;
	}
}

function createArtifactService() {
	return new ArtifactService({
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
}

async function withServer(
	repo: RunRepo,
	launcher: { startRunOnce(runId: string): Promise<void> },
	run: (base: string) => Promise<void>,
): Promise<void> {
	const runService = new RunService({
		runRepo: repo,
		workflowLauncher: launcher as never,
	});
	const app = buildApiRouter({
		artifactService: createArtifactService(),
		runService,
	});
	const server = app.listen(0);
	try {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		await run(`http://127.0.0.1:${address.port}`);
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

function runPayload() {
	return {
		runId: RUN_ID,
		scope: "team",
		userMsg: "hello",
		attachments: [],
	};
}

describe("run idempotency over POST /runs", () => {
	it("starts workflow once for duplicate runId requests", async () => {
		const launches: string[] = [];
		await withServer(
			new InMemoryRunRepo(),
			{
				startRunOnce: async (runId) => {
					launches.push(runId);
				},
			},
			async (base) => {
				const first = await fetch(`${base}/runs`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(runPayload()),
				});
				const second = await fetch(`${base}/runs`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(runPayload()),
				});

				expect(first.status).toBe(201);
				expect(second.status).toBe(200);
			},
		);
		expect(launches).toEqual([RUN_ID]);
	});

	it("retries a queued run after the first launch attempt fails", async () => {
		const launches: string[] = [];
		let failFirst = true;
		await withServer(
			new InMemoryRunRepo(),
			{
				startRunOnce: async (runId) => {
					launches.push(runId);
					if (failFirst) {
						failFirst = false;
						throw new Error("launcher offline");
					}
				},
			},
			async (base) => {
				const first = await fetch(`${base}/runs`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(runPayload()),
				});
				const second = await fetch(`${base}/runs`, {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify(runPayload()),
				});

				expect(first.status).toBe(500);
				expect(second.status).toBe(200);
			},
		);
		expect(launches).toEqual([RUN_ID, RUN_ID]);
	});
});
