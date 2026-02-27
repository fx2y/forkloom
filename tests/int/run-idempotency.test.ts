import { afterAll, describe, expect, it } from "vitest";
import { buildApiRouter } from "../../apps/api/src/http/routes";
import type {
	RunModel,
	RunRepo,
	RunSpecModel,
} from "../../apps/api/src/run/ports";
import { RunService } from "../../apps/api/src/run/service";
import { ArtifactService } from "../../apps/api/src/service";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";

function makeRun(spec: RunSpecModel): RunModel {
	return {
		runId: spec.runId,
		status: "running",
		spec,
		createdAt: "2026-02-27T00:00:00.000Z",
		updatedAt: "2026-02-27T00:00:00.000Z",
		dbosWorkflowId: spec.runId,
		piSessionId: null,
		piSessionFile: null,
		resultText: null,
		resultStats: null,
		error: null,
	};
}

describe("run idempotency over POST /runs", () => {
	const launches: string[] = [];
	let created = false;

	const runRepo: RunRepo = {
		createRun: async ({ spec }) => {
			if (!created) {
				created = true;
				return { run: makeRun(spec), created: true };
			}
			return { run: makeRun(spec), created: false };
		},
		getRun: async () => null,
		appendEvent: async () => {
			throw new Error("unused");
		},
		listEventsSince: async () => {
			throw new Error("unused");
		},
		listArtifacts: async () => [],
		markDone: async () => null,
		markFailed: async () => null,
		linkArtifact: async () => undefined,
	};

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

	const app = buildApiRouter({
		artifactService,
		runService,
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

	it("starts workflow once for duplicate runId requests", async () => {
		const address = server.address();
		if (!address || typeof address === "string") {
			throw new Error("failed to bind test server");
		}
		const base = `http://127.0.0.1:${address.port}`;
		const payload = {
			runId: RUN_ID,
			scope: "team",
			userMsg: "hello",
			attachments: [],
		};

		const first = await fetch(`${base}/runs`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		});
		const second = await fetch(`${base}/runs`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(payload),
		});

		expect(first.status).toBe(201);
		expect(second.status).toBe(200);
		expect(launches).toEqual([RUN_ID]);
	});
});
