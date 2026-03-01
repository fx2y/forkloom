import { describe, expect, it } from "vitest";
import {
	RunTransientError,
	executeRunSandbox,
} from "../../apps/api/src/workflow/run-sandbox";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
const ISO = "2026-02-28T00:00:00.000Z";

const stepRunner = {
	runStep: async <T>(_name: string, fn: () => Promise<T>) => fn(),
};

function makeSandbox() {
	return {
		runId: RUN_ID,
		sandboxId: "sbx",
		backend: "docker" as const,
		profile: "safe" as const,
		state: "ready" as const,
		approvalState: "approved" as const,
		spec: {
			runId: RUN_ID,
			sandboxId: "sbx",
			profile: "safe" as const,
			backend: "docker" as const,
			imageDigest: "node:24-alpine",
			containerName: "sbx",
			workVolume: "sbx-work",
			workdir: "/work",
			piHomeHostDir: "/tmp/forkloom-pi",
			piHomePath: "/pi-home",
			mounts: [
				{
					kind: "inputs" as const,
					source: "/tmp/forkloom-inputs",
					dest: "/inputs",
					mode: "ro" as const,
				},
			],
			env: {},
			network: "off" as const,
			cpuMillicores: 500,
			memoryMb: 512,
			diskMb: 1024,
			timeoutSec: 900,
			maxBytesOut: 1024,
		},
		previewSpec: {
			imageDigest: "node:24-alpine",
			profile: "safe" as const,
			network: "off" as const,
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
	};
}

describe("executeRunSandbox", () => {
	it("processes approve commands and re-enqueues the next pending seq", async () => {
		const launches: string[] = [];
		let approved = 0;
		await executeRunSandbox(
			RUN_ID,
			{
				runRepo: {
					getRun: async () => ({
						runId: RUN_ID,
						status: "queued",
						spec: {
							runId: RUN_ID,
							scope: "team",
							userMsg: "hi",
							attachments: [],
							profile: "safe",
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
					appendArtifactWritten: async () => {
						throw new Error("not used");
					},
					appendPiEvent: async () => {
						throw new Error("not used");
					},
					appendRunEvent: async () => ({
						eventId: 1,
						runId: RUN_ID,
						kind: "run_approved",
						payload: {},
						createdAt: ISO,
					}),
					beginRun: async () => {
						throw new Error("not used");
					},
					failRun: async () => null,
					linkArtifact: async () => undefined,
					recordStepLedger: async () => undefined,
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
				sandboxRepo: {
					acquireLease: async () => true,
					claimNextCommand: async () => ({
						runId: RUN_ID,
						seq: 2,
						kind: "approve",
						payload: {},
						dedupeKey: null,
						state: "claimed",
						claimedBy: "wf",
						claimedAt: ISO,
						leaseExpiresAt: ISO,
						doneAt: null,
						error: null,
						createdAt: ISO,
					}),
					getSandbox: async () => makeSandbox(),
					getCurrentCommand: async () => null,
					markApproved: async () => {
						approved += 1;
						return makeSandbox();
					},
					markCommandDead: async () => null,
					persistExec: async () => ({
						exec: {} as never,
						sandbox: makeSandbox(),
						nextPendingSeq: 3,
					}),
					requeueCommand: async () => null,
					releaseLease: async () => undefined,
				},
				backend: {
					ensure: async () => makeSandbox(),
					exec: async () => {
						throw new Error("not used");
					},
					snapshot: async () => {
						throw new Error("not used");
					},
					destroy: async () => null,
				},
				workflowLauncher: {
					startRunOnce: async (_runId, opts) => {
						launches.push(opts.workflowID);
					},
				},
				createPiSession: async () => {
					throw new Error("not used");
				},
				workflowId: "wf",
			},
			stepRunner,
		);

		expect(approved).toBe(1);
		expect(launches).toEqual([`run:${RUN_ID}:3`]);
	});

	it("requeues transient command failures instead of dead-lettering them", async () => {
		let requeued = 0;
		await expect(
			executeRunSandbox(
				RUN_ID,
				{
					runRepo: {
						getRun: async () => ({
							runId: RUN_ID,
							status: "running",
							spec: {
								runId: RUN_ID,
								scope: "team",
								userMsg: "hi",
								attachments: [],
								profile: "safe",
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
						appendArtifactWritten: async () => {
							throw new Error("not used");
						},
						appendPiEvent: async () => {
							throw new Error("not used");
						},
						appendRunEvent: async () => {
							throw new Error("not used");
						},
						beginRun: async () => {
							throw new Error("not used");
						},
						failRun: async () => null,
						linkArtifact: async () => undefined,
						recordStepLedger: async () => undefined,
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
					sandboxRepo: {
						acquireLease: async () => true,
						claimNextCommand: async () => ({
							runId: RUN_ID,
							seq: 2,
							kind: "prompt",
							payload: { text: "hi" },
							dedupeKey: null,
							state: "claimed",
							claimedBy: "wf",
							claimedAt: ISO,
							leaseExpiresAt: ISO,
							doneAt: null,
							error: null,
							createdAt: ISO,
						}),
						getSandbox: async () => makeSandbox(),
						getCurrentCommand: async () => null,
						markApproved: async () => makeSandbox(),
						markCommandDead: async () => null,
						persistExec: async () => {
							throw new Error("not used");
						},
						requeueCommand: async () => {
							requeued += 1;
							return 2;
						},
						releaseLease: async () => undefined,
					},
					backend: {
						ensure: async () => makeSandbox(),
						exec: async () => {
							throw new Error("not used");
						},
						snapshot: async () => {
							throw new Error("not used");
						},
						destroy: async () => null,
					},
					workflowLauncher: {
						startRunOnce: async () => undefined,
					},
					createPiSession: async () => {
						throw new RunTransientError("retry");
					},
					workflowId: "wf",
				},
				stepRunner,
			),
		).rejects.toThrow("retry");

		expect(requeued).toBe(1);
	});

	it("does not dead-letter commands when claim ownership is already lost", async () => {
		let dead = 0;
		let failed = 0;
		await expect(
			executeRunSandbox(
				RUN_ID,
				{
					runRepo: {
						getRun: async () => ({
							runId: RUN_ID,
							status: "queued",
							spec: {
								runId: RUN_ID,
								scope: "team",
								userMsg: "hi",
								attachments: [],
								profile: "safe",
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
						appendArtifactWritten: async () => {
							throw new Error("not used");
						},
						appendPiEvent: async () => {
							throw new Error("not used");
						},
						appendRunEvent: async () => ({
							eventId: 1,
							runId: RUN_ID,
							kind: "run_approved",
							payload: {},
							createdAt: ISO,
						}),
						beginRun: async () => {
							throw new Error("not used");
						},
						failRun: async () => {
							failed += 1;
							return null;
						},
						linkArtifact: async () => undefined,
						recordStepLedger: async () => undefined,
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
					sandboxRepo: {
						acquireLease: async () => true,
						claimNextCommand: async () => ({
							runId: RUN_ID,
							seq: 2,
							kind: "approve",
							payload: {},
							dedupeKey: null,
							state: "claimed",
							claimedBy: "wf",
							claimedAt: ISO,
							leaseExpiresAt: ISO,
							doneAt: null,
							error: null,
							createdAt: ISO,
						}),
						getSandbox: async () => makeSandbox(),
						getCurrentCommand: async () => null,
						markApproved: async () => makeSandbox(),
						markCommandDead: async () => {
							dead += 1;
							return null;
						},
						persistExec: async () => {
							throw new Error(
								`persist exec: command claim lost run=${RUN_ID} seq=2`,
							);
						},
						requeueCommand: async () => null,
						releaseLease: async () => undefined,
					},
					backend: {
						ensure: async () => makeSandbox(),
						exec: async () => {
							throw new Error("not used");
						},
						snapshot: async () => {
							throw new Error("not used");
						},
						destroy: async () => null,
					},
					workflowLauncher: {
						startRunOnce: async () => undefined,
					},
					createPiSession: async () => {
						throw new Error("not used");
					},
					workflowId: "wf",
				},
				stepRunner,
			),
		).rejects.toThrow("persist exec: command claim lost");

		expect(dead).toBe(0);
		expect(failed).toBe(0);
	});
});
