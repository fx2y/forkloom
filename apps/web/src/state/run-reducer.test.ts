import { describe, expect, it } from "vitest";
import {
	hydrateRunDocResolve,
	hydrateRunDocSearch,
	hydrateRunSkillPreview,
	hydrateRunSkills,
	hydrateRunState,
	hydrateRunTruth,
	initialRunViewState,
	reduceRunEvent,
	selectRunPublishTarget,
	selectRunScope,
	selectRunSkill,
	selectRunWriteTarget,
	toSpanKey,
} from "./run-reducer";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";

describe("run reducer", () => {
	it("hydrates preview/files and dedupes artifacts by sha", () => {
		const state = hydrateRunState(initialRunViewState, {
			runId: RUN_ID,
			status: "awaiting_approval",
			startedAt: "2026-02-28T00:00:00.000Z",
			dbosWfId: RUN_ID,
			preview: {
				imageDigest: "node:24-alpine",
				profile: "priv",
				network: "egress",
				workdir: "/work",
				timeoutSec: 900,
				maxBytesOut: 1024,
				mounts: [],
			},
			approval: { required: true, state: "pending" },
			files: {
				workspaceRef: { sha256: "a".repeat(64) },
				entries: [
					{
						path: "project/proof.txt",
						bytes: 12,
						sha256: "b".repeat(64),
					},
				],
			},
			artifacts: [{ sha256: "a".repeat(64) }],
		});

		expect(state.artifacts).toHaveLength(2);
		expect((state.run?.files as Record<string, unknown>)?.entries).toBeTruthy();
		expect(state.selectedScope).toBe("team");
		expect(state.selectedWriteTarget).toBe("ws");
		expect(state.selectedPublishTarget).toBe("org");
	});

	it("reduces interactive run events into truthful status and trace state", () => {
		const seeded = hydrateRunState(initialRunViewState, {
			runId: RUN_ID,
			status: "queued",
			startedAt: "2026-02-28T00:00:00.000Z",
			dbosWfId: RUN_ID,
			artifacts: [],
		});

		const started = reduceRunEvent(seeded, {
			runId: RUN_ID,
			seq: 1,
			t: "2026-02-28T00:00:01.000Z",
			kind: "run_started",
			payload: { scope: "team" },
		});
		const aborted = reduceRunEvent(started, {
			runId: RUN_ID,
			seq: 2,
			t: "2026-02-28T00:00:02.000Z",
			kind: "run_aborted",
			payload: { seq: 2 },
		});

		expect(aborted.run?.status).toBe("aborted");
		expect(aborted.trace.map((entry) => entry.kind)).toEqual([
			"run_started",
			"run_aborted",
		]);
	});

	it("hydrates provenance graph from truth bundle links", () => {
		const seeded = hydrateRunState(initialRunViewState, {
			runId: RUN_ID,
			status: "running",
			startedAt: "2026-02-28T00:00:00.000Z",
			dbosWfId: RUN_ID,
			artifacts: [],
		});

		const hydrated = hydrateRunTruth(seeded, {
			run: {
				runId: RUN_ID,
				status: "done",
				spec: {
					runId: RUN_ID,
					scope: "team",
					userMsg: "ship it",
					attachments: [],
					orgId: "org-1",
					writeTarget: "ws",
					profile: "safe",
				},
				createdAt: "2026-02-28T00:00:00.000Z",
				updatedAt: "2026-02-28T00:00:01.000Z",
				dbosWorkflowId: RUN_ID,
				piSessionId: "session-1",
				piSessionFile: "/tmp/session.jsonl",
				resultText: "done",
				resultStats: {},
				error: null,
			},
			steps: [],
			links: [
				{
					runId: RUN_ID,
					stepName: "run_command",
					attempt: 1,
					sessionEntryIds: ["entry-1"],
					artifactShas: ["a".repeat(64), "b".repeat(64)],
					note: "step=run_command",
					createdAt: "2026-02-28T00:00:02.000Z",
				},
			],
			artifacts: [
				{
					runId: RUN_ID,
					sha256: "a".repeat(64),
					kind: "pi_session_jsonl",
					createdAt: "2026-02-28T00:00:02.000Z",
				},
			],
			sessionIndex: null,
			stepPayloads: [],
		});

		expect(hydrated.provenanceByArtifact["a".repeat(64)]).toEqual([
			{
				artifact: "a".repeat(64),
				runId: RUN_ID,
				stepName: "run_command",
				attempt: 1,
				sessionIds: ["entry-1"],
				parentShas: ["b".repeat(64)],
			},
		]);
	});

	it("hydrates doc search + resolve rows keyed by SpanRef identity", () => {
		const searched = hydrateRunDocSearch(initialRunViewState, {
			query: "invoice total",
			scope: "*",
			hits: [
				{
					chunkId: "chunk:1",
					score: 1.23,
					snippet: "Invoice total is $19.99",
					spans: [
						{
							docSha: "a".repeat(64),
							parseId: "parse:1",
							page: 1,
							bbox: [0, 0, 100, 100],
							charStart: 0,
							charEnd: 10,
							blockPath: "p1/b1",
							chunkId: "chunk:1",
						},
					],
				},
			],
		});
		expect(searched.docSearch?.hits.length).toBe(1);
		const span = searched.docSearch?.hits[0]?.spans[0];
		if (!span) {
			throw new Error("missing test span");
		}
		const resolved = hydrateRunDocResolve(searched, {
			span,
			md: "Total: $19.99",
			bbox: [0, 0, 100, 100],
			pageImageSha: "b".repeat(64),
		});
		const key = toSpanKey(span);
		expect(resolved.resolvedSpanByKey[key]?.md).toContain("19.99");
	});

	it("keeps skill list and preview inside reducer-owned state transitions", () => {
		const seeded = hydrateRunSkills(initialRunViewState, [
			{
				skillId: "policy-qa",
				name: "policy-qa",
				description: "Policy checks",
				path: "/skills/policy-qa/SKILL.md",
				scope: "workspace",
				hidden: false,
				menuVisible: true,
			},
			{
				skillId: "meeting-to-actions",
				name: "meeting-to-actions",
				description: "Action follow-through",
				path: "/skills/meeting-to-actions/SKILL.md",
				scope: "workspace",
				hidden: false,
				menuVisible: true,
			},
		]);
		expect(seeded.skills.map((skill) => skill.name)).toEqual([
			"meeting-to-actions",
			"policy-qa",
		]);
		expect(seeded.selectedSkillName).toBe("meeting-to-actions");

		const selected = selectRunSkill(seeded, "policy-qa");
		expect(selected.selectedSkillName).toBe("policy-qa");
		expect(selected.selectedSkillPreview).toBeNull();

		const previewed = hydrateRunSkillPreview(selected, {
			skillName: "policy-qa",
			description: "Policy checks",
			scripts: ["scripts/emit-policy-answer.sh"],
			touchedPaths: ["scripts/emit-policy-answer.sh"],
			manualOnly: false,
			menuVisible: true,
		});
		expect(previewed.selectedSkillName).toBe("policy-qa");
		expect(previewed.selectedSkillPreview?.scripts).toEqual([
			"scripts/emit-policy-answer.sh",
		]);
	});

	it("collapses noisy tool_result traces and appends artifact pointer from pi_event", () => {
		const seeded = hydrateRunState(initialRunViewState, {
			runId: RUN_ID,
			status: "running",
			startedAt: "2026-02-28T00:00:00.000Z",
			dbosWfId: RUN_ID,
			artifacts: [],
		});
		const reduced = reduceRunEvent(seeded, {
			runId: RUN_ID,
			seq: 1,
			t: "2026-02-28T00:00:01.000Z",
			kind: "pi_event",
			payload: {
				event: {
					type: "tool_result",
					toolName: "skill_exec",
					result: { details: { artifactSha: "a".repeat(64) } },
				},
			},
		});
		expect(reduced.trace[0]?.detail).toBe("skill_exec result (collapsed)");
		expect(
			reduced.artifacts.some((entry) => entry.key.endsWith("a".repeat(64))),
		).toBe(true);
	});

	it("keeps explicit scope/write-target/publish-target inside reducer state", () => {
		const scoped = selectRunScope(initialRunViewState, "org");
		expect(scoped.selectedScope).toBe("org");

		const writeScoped = selectRunWriteTarget(scoped, "member");
		expect(writeScoped.selectedWriteTarget).toBe("member");

		const publishScoped = selectRunPublishTarget(writeScoped, "ws");
		expect(publishScoped.selectedPublishTarget).toBe("ws");

		const noConflict = selectRunWriteTarget(publishScoped, "ws");
		expect(noConflict.selectedPublishTarget).toBe("org");
	});
});
