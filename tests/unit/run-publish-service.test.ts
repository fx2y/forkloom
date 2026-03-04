import { DBOS } from "@dbos-inc/dbos-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RunService } from "../../apps/api/src/run/service";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
const ISO = "2026-03-04T00:00:00.000Z";

function makeRun(input: {
	writeTarget: "org" | "ws" | "member";
	scope?: "me" | "team" | "org";
	wsId?: string | undefined;
	memberId?: string | undefined;
}) {
	return {
		runId: RUN_ID,
		status: "running" as const,
		spec: {
			runId: RUN_ID,
			scope: input.scope ?? "team",
			userMsg: "ship it",
			attachments: [],
			orgId: "00000000-0000-0000-0000-000000000001",
			wsId: input.wsId,
			memberId: input.memberId,
			writeTarget: input.writeTarget,
		},
		createdAt: ISO,
		updatedAt: ISO,
		dbosWorkflowId: RUN_ID,
		piSessionId: null,
		piSessionFile: null,
		resultText: null,
		resultStats: null,
		error: null,
	};
}

function createService(run = makeRun({ writeTarget: "ws", wsId: "ws-1" })) {
	return new RunService({
		runRepo: {
			createRun: async () => ({ run, created: true }),
			recordWorkflowLaunch: async () => run,
			beginRun: async () => {
				throw new Error("unused");
			},
			getRun: async () => run,
			appendEvent: async () => ({
				eventId: 1,
				runId: RUN_ID,
				kind: "run_started",
				payload: {},
				createdAt: ISO,
			}),
			listEventsSince: async () => [],
			listArtifacts: async () => [],
			createStep: async () => {
				throw new Error("unused");
			},
			upsertLink: async () => {
				throw new Error("unused");
			},
			upsertSessionIndex: async () => {
				throw new Error("unused");
			},
			upsertStepPayload: async () => {
				throw new Error("unused");
			},
			recordStepLedger: async () => undefined,
			listSteps: async () => [],
			listLinks: async () => [],
			listStepPayloads: async () => [],
			getTruthBundle: async () => null,
			completeRun: async () => ({ run: null, event: null }),
			failRun: async () => ({ run: null, event: null }),
			linkArtifact: async () => undefined,
		} as never,
		workflowLauncher: {
			startRunOnce: async () => undefined,
		},
		promotion: {
			promoteMemberToWs: async () => ({ sha: "a".repeat(64) }),
			promoteWsToOrg: async () => ({ sha: "b".repeat(64) }),
		},
	});
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("RunService publishObject", () => {
	it("promotes member->ws through DBOS workflow handle", async () => {
		const service = createService(
			makeRun({
				writeTarget: "member",
				wsId: "ws-1",
				memberId: "member-1",
			}),
		);
		const startSpy = vi
			.spyOn(DBOS, "startWorkflow")
			.mockImplementation(((workflow: unknown, opts: { workflowID: string }) => {
				return async (input: unknown) => ({
					getResult: async () =>
						(workflow as (arg: unknown) => Promise<{ sha: string | null }>)(input),
					workflowID: opts.workflowID,
				});
			}) as never);

		const published = await service.publishObject({
			runId: RUN_ID,
			kind: "policy",
			key: "policy/default",
			scope: "team",
			writeTarget: "member",
			publishTarget: "ws",
		});

		expect(startSpy).toHaveBeenCalledTimes(1);
		expect(published.sha).toBe("a".repeat(64));
		expect(published.fromTarget).toBe("member");
		expect(published.publishTarget).toBe("ws");
		expect(published.workflowID).toContain("publish:m2w:");
	});

	it("promotes ws->org through DBOS workflow handle", async () => {
		const service = createService(makeRun({ writeTarget: "ws", wsId: "ws-1" }));
		vi.spyOn(DBOS, "startWorkflow").mockImplementation(((workflow: unknown) => {
			return async (input: unknown) => ({
				getResult: async () =>
					(workflow as (arg: unknown) => Promise<{ sha: string | null }>)(input),
			});
		}) as never);

		const published = await service.publishObject({
			runId: RUN_ID,
			kind: "policy",
			key: "policy/default",
			scope: "team",
			writeTarget: "ws",
			publishTarget: "org",
		});

		expect(published.sha).toBe("b".repeat(64));
		expect(published.workflowID).toContain("publish:w2o:");
	});

	it("rejects scope/write-target mismatches and unsupported transitions", async () => {
		const service = createService(makeRun({ writeTarget: "ws", wsId: "ws-1" }));
		await expect(
			service.publishObject({
				runId: RUN_ID,
				kind: "policy",
				key: "policy/default",
				scope: "org",
				writeTarget: "ws",
				publishTarget: "org",
			}),
		).rejects.toMatchObject({ status: 409 });

		await expect(
			service.publishObject({
				runId: RUN_ID,
				kind: "policy",
				key: "policy/default",
				scope: "team",
				writeTarget: "ws",
				publishTarget: "member",
			}),
		).rejects.toMatchObject({
			status: 409,
			message: "unsupported publish transition: ws->member",
		});
	});
});
