import { describe, expect, it } from "vitest";
import { RunService } from "../../apps/api/src/run/service";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
const ISO = "2026-02-28T00:00:00.000Z";

function makeRun() {
	return {
		runId: RUN_ID,
		status: "queued" as const,
		spec: {
			runId: RUN_ID,
			scope: "team" as const,
			userMsg: "ship it",
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
	};
}

describe("RunService sandbox persist-first path", () => {
	it("queues without launch when approval is still pending", async () => {
		const launches: string[] = [];
		const events: string[] = [];
		const service = new RunService({
			runRepo: {
				createRun: async () => ({ run: makeRun(), created: true }),
				recordWorkflowLaunch: async () => makeRun(),
				beginRun: async () => {
					throw new Error("not used");
				},
				getRun: async () => makeRun(),
				appendEvent: async (input) => {
					events.push(input.kind);
					return {
						eventId: events.length,
						runId: input.runId,
						kind: input.kind,
						payload: input.payload,
						createdAt: ISO,
					};
				},
				listEventsSince: async () => [],
				listArtifacts: async () => [],
				createStep: async () => {
					throw new Error("not used");
				},
				upsertLink: async () => {
					throw new Error("not used");
				},
				upsertSessionIndex: async () => {
					throw new Error("not used");
				},
				upsertStepPayload: async () => {
					throw new Error("not used");
				},
				recordStepLedger: async () => undefined,
				listSteps: async () => [],
				listLinks: async () => [],
				listStepPayloads: async () => [],
				getTruthBundle: async () => null,
				completeRun: async () => ({ run: null, event: null }),
				failRun: async () => ({ run: null, event: null }),
				linkArtifact: async () => undefined,
			},
			workflowLauncher: {
				startRunOnce: async (_runId, opts) => {
					launches.push(opts.workflowID);
				},
			},
			sandbox: {
				createRunPlan: (spec) => ({
					sandboxSpec: {
						runId: spec.runId,
						sandboxId: "sbx",
						profile: "priv",
						backend: "docker",
						imageDigest: "node:24-alpine",
						containerName: "sbx",
						workVolume: "sbx-work",
						workdir: "/work",
						piHomeHostDir: "/tmp/pi-home",
						piHomePath: "/pi-home",
						mounts: [],
						env: {},
						network: "egress",
						cpuMillicores: 1_000,
						memoryMb: 1_024,
						diskMb: 1_024,
						timeoutSec: 900,
						maxBytesOut: 1024,
					},
					previewSpec: {
						imageDigest: "node:24-alpine",
						profile: "priv",
						network: "egress",
						containerName: "sbx",
						workVolume: "sbx-work",
						workdir: "/work",
						timeoutSec: 900,
						maxBytesOut: 1024,
						mounts: [],
					},
					initialCommand: {
						kind: "prompt",
						payload: { text: "ship it" },
						dedupeKey: "init",
					},
				}),
				sandboxRepo: {
					createSandbox: async () => ({
						sandbox: {
							runId: RUN_ID,
							sandboxId: "sbx",
							backend: "docker",
							profile: "priv",
							state: "missing",
							approvalState: "pending",
							spec: {} as never,
							previewSpec: {
								imageDigest: "node:24-alpine",
								profile: "priv",
								network: "egress",
								containerName: "sbx",
								workVolume: "sbx-work",
								workdir: "/work",
								timeoutSec: 900,
								maxBytesOut: 1024,
								mounts: [],
							},
							containerName: "sbx",
							workVolume: "sbx-work",
							inflightWorkflowId: null,
							leaseExpiresAt: null,
							createdAt: ISO,
							updatedAt: ISO,
							lastSeenAt: ISO,
						},
						created: true,
					}),
					getSandbox: async () => null,
					getCurrentCommand: async () => null,
					listExecs: async () => [],
					markApproved: async () => null,
					queueCommand: async () => ({
						command: {
							runId: RUN_ID,
							seq: 1,
							kind: "prompt",
							payload: { text: "ship it" },
							dedupeKey: "init",
							state: "queued",
							claimedBy: null,
							claimedAt: null,
							leaseExpiresAt: null,
							doneAt: null,
							error: null,
							createdAt: ISO,
						},
						created: true,
						firstPendingSeq: 1,
					}),
				},
				artifactService: {
					getArtifactBytes: async () => {
						throw new Error("not used");
					},
					getArtifactMeta: async () => {
						throw new Error("not used");
					},
					putArtifact: async () => {
						throw new Error("not used");
					},
				},
			},
		});

		const started = await service.startRun({
			runId: RUN_ID,
			scope: "team",
			userMsg: "ship it",
			attachments: [],
			profile: "priv",
		});

		expect(started.command?.seq).toBe(1);
		expect(launches).toEqual([]);
		expect(events).toEqual([
			"run_previewed",
			"run_approval_required",
			"run_command_queued",
		]);
	});

	it("rejects interactive commands when run is terminal", async () => {
		let queuedCalls = 0;
		const service = new RunService({
			runRepo: {
				createRun: async () => ({ run: makeRun(), created: true }),
				recordWorkflowLaunch: async () => makeRun(),
				beginRun: async () => {
					throw new Error("not used");
				},
				getRun: async () => ({
					...makeRun(),
					status: "done",
					resultText: "ok",
					resultStats: {},
				}),
				appendEvent: async () => {
					throw new Error("not used");
				},
				listEventsSince: async () => [],
				listArtifacts: async () => [],
				createStep: async () => {
					throw new Error("not used");
				},
				upsertLink: async () => {
					throw new Error("not used");
				},
				upsertSessionIndex: async () => {
					throw new Error("not used");
				},
				upsertStepPayload: async () => {
					throw new Error("not used");
				},
				recordStepLedger: async () => undefined,
				listSteps: async () => [],
				listLinks: async () => [],
				listStepPayloads: async () => [],
				getTruthBundle: async () => null,
				completeRun: async () => ({ run: null, event: null }),
				failRun: async () => ({ run: null, event: null }),
				linkArtifact: async () => undefined,
			},
			workflowLauncher: {
				startRunOnce: async () => undefined,
			},
			sandbox: {
				createRunPlan: () => {
					throw new Error("not used");
				},
				sandboxRepo: {
					createSandbox: async () => {
						throw new Error("not used");
					},
					getSandbox: async () =>
						({
							...makeRun(),
							runId: RUN_ID,
						}) as never,
					getCurrentCommand: async () => null,
					listExecs: async () => [],
					markApproved: async () => null,
					queueCommand: async () => {
						queuedCalls += 1;
						throw new Error("not used");
					},
				},
				artifactService: {
					getArtifactBytes: async () => {
						throw new Error("not used");
					},
					getArtifactMeta: async () => {
						throw new Error("not used");
					},
					putArtifact: async () => {
						throw new Error("not used");
					},
				},
			},
		});

		await expect(
			service.queueCommand({
				runId: RUN_ID,
				kind: "prompt",
				payload: { text: "ship it" },
			}),
		).rejects.toMatchObject({
			status: 409,
			message: "run is terminal (done); command queue is closed",
		});
		expect(queuedCalls).toBe(0);
	});

	it("queues interactive commands for non-terminal runs", async () => {
		const launches: string[] = [];
		let queuedCalls = 0;
		const service = new RunService({
			runRepo: {
				createRun: async () => ({ run: makeRun(), created: true }),
				recordWorkflowLaunch: async () => makeRun(),
				beginRun: async () => {
					throw new Error("not used");
				},
				getRun: async () => ({
					...makeRun(),
					status: "running",
				}),
				appendEvent: async (input) => ({
					eventId: 1,
					runId: input.runId,
					kind: input.kind,
					payload: input.payload,
					createdAt: ISO,
				}),
				listEventsSince: async () => [],
				listArtifacts: async () => [],
				createStep: async () => {
					throw new Error("not used");
				},
				upsertLink: async () => {
					throw new Error("not used");
				},
				upsertSessionIndex: async () => {
					throw new Error("not used");
				},
				upsertStepPayload: async () => {
					throw new Error("not used");
				},
				recordStepLedger: async () => undefined,
				listSteps: async () => [],
				listLinks: async () => [],
				listStepPayloads: async () => [],
				getTruthBundle: async () => null,
				completeRun: async () => ({ run: null, event: null }),
				failRun: async () => ({ run: null, event: null }),
				linkArtifact: async () => undefined,
			},
			workflowLauncher: {
				startRunOnce: async (_runId, opts) => {
					launches.push(opts.workflowID);
				},
			},
			sandbox: {
				createRunPlan: () => {
					throw new Error("not used");
				},
				sandboxRepo: {
					createSandbox: async () => {
						throw new Error("not used");
					},
					getSandbox: async () =>
						({
							runId: RUN_ID,
							sandboxId: "sbx",
							backend: "docker",
							profile: "priv",
							state: "ready",
							approvalState: "approved",
							spec: {
								runId: RUN_ID,
								sandboxId: "sbx",
								profile: "priv",
								backend: "docker",
								imageDigest: "node:24-alpine",
								containerName: "sbx",
								workVolume: "sbx-work",
								workdir: "/work",
								piHomeHostDir: "/tmp/pi-home",
								piHomePath: "/pi-home",
								mounts: [],
								env: {},
								network: "egress",
								cpuMillicores: 1_000,
								memoryMb: 1_024,
								diskMb: 1_024,
								timeoutSec: 900,
								maxBytesOut: 1024,
							},
							previewSpec: {
								imageDigest: "node:24-alpine",
								profile: "priv",
								network: "egress",
								containerName: "sbx",
								workVolume: "sbx-work",
								workdir: "/work",
								timeoutSec: 900,
								maxBytesOut: 1024,
								mounts: [],
							},
							containerName: "sbx",
							workVolume: "sbx-work",
							inflightWorkflowId: null,
							leaseExpiresAt: null,
							createdAt: ISO,
							updatedAt: ISO,
							lastSeenAt: ISO,
						}) as never,
					getCurrentCommand: async () => null,
					listExecs: async () => [],
					markApproved: async () => null,
					queueCommand: async () => {
						queuedCalls += 1;
						return {
							command: {
								runId: RUN_ID,
								seq: 2,
								kind: "followUp" as const,
								payload: { text: "more" },
								dedupeKey: null,
								state: "queued" as const,
								claimedBy: null,
								claimedAt: null,
								leaseExpiresAt: null,
								doneAt: null,
								error: null,
								createdAt: ISO,
							},
							created: true,
							firstPendingSeq: 2,
						};
					},
				},
				artifactService: {
					getArtifactBytes: async () => {
						throw new Error("not used");
					},
					getArtifactMeta: async () => {
						throw new Error("not used");
					},
					putArtifact: async () => {
						throw new Error("not used");
					},
				},
			},
		});

		const queued = await service.queueCommand({
			runId: RUN_ID,
			kind: "followUp",
			payload: { text: "more" },
		});

		expect(queued.created).toBe(true);
		expect(queued.command.seq).toBe(2);
		expect(queuedCalls).toBe(1);
		expect(launches).toEqual([`run:${RUN_ID}:2`]);
	});
});
