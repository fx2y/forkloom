import { describe, expect, it } from "vitest";
import { RunService } from "../../apps/api/src/run/service";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
const ISO = "2026-03-02T00:00:00.000Z";

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

function makeRunRepo(run = makeRun()) {
	return {
		createRun: async () => ({ run, created: true }),
		recordWorkflowLaunch: async () => run,
		beginRun: async () => {
			throw new Error("not used");
		},
		getRun: async () => run,
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
	};
}

describe("RunService skill surface seam", () => {
	it("keeps skill list behind the run-owned service seam", async () => {
		let listCalls = 0;
		const service = new RunService({
			runRepo: makeRunRepo(),
			workflowLauncher: {
				startRunOnce: async () => undefined,
			},
			skills: {
				listSkills: async () => {
					listCalls += 1;
					return [
						{
							skillId: "policy-qa",
							name: "Policy QA",
							description: "Answer policy questions with references",
							path: "/skills/policy-qa/SKILL.md",
							scope: "workspace",
							hidden: false,
							menuVisible: true,
							hash: "a".repeat(64),
						},
					];
				},
				previewSkill: async () => null,
			},
		});

		const skills = await service.listSkills(RUN_ID);
		expect(listCalls).toBe(1);
		expect(skills).toHaveLength(1);
		expect(skills[0]?.skillId).toBe("policy-qa");
	});

	it("rejects preview reads when the run does not exist", async () => {
		const service = new RunService({
			runRepo: {
				...makeRunRepo(),
				getRun: async () => null,
			},
			workflowLauncher: {
				startRunOnce: async () => undefined,
			},
			skills: {
				listSkills: async () => [],
				previewSkill: async () => null,
			},
		});

		await expect(
			service.previewSkill({
				runId: RUN_ID,
				skillName: "policy-qa",
			}),
		).rejects.toThrow(`run not found: ${RUN_ID}`);
	});
});
