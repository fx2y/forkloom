import { describe, expect, it } from "vitest";
import type {
	RunArtifactLinkModel,
	RunEventModel,
	RunModel,
} from "../../apps/api/src/run/ports";
import {
	toRunEventContract,
	toRunStateContract,
} from "../../apps/api/src/run/projection";

const BASE_TS = "2026-02-28T00:00:00.000Z";

function makeRunModel(overrides: Partial<RunModel> = {}): RunModel {
	return {
		runId: "run-1",
		status: "running",
		spec: {
			runId: "run-1",
			scope: "me",
			userMsg: "hi",
			attachments: [],
			orgId: "org-1",
			writeTarget: "member",
		},
		createdAt: BASE_TS,
		updatedAt: BASE_TS,
		dbosWorkflowId: "wf-1",
		piSessionId: null,
		piSessionFile: null,
		resultText: null,
		resultStats: null,
		error: null,
		...overrides,
	};
}

function makeEventModel(overrides: Partial<RunEventModel> = {}): RunEventModel {
	return {
		eventId: 1,
		runId: "run-1",
		kind: "run_started",
		payload: {},
		createdAt: BASE_TS,
		...overrides,
	};
}

function makeArtifactLink(
	sha256: string,
	kind = "input_attachment",
): RunArtifactLinkModel {
	return { runId: "run-1", sha256, kind, createdAt: BASE_TS };
}

describe("toRunEventContract", () => {
	it("maps run_started event", () => {
		const event = toRunEventContract(
			makeEventModel({ kind: "run_started", payload: { scope: "me" } }),
		);
		expect(event.kind).toBe("run_started");
		expect(event.runId).toBe("run-1");
		expect(event.seq).toBe(1);
		expect(event.t).toBe(BASE_TS);
	});

	it("maps pi_event", () => {
		const event = toRunEventContract(
			makeEventModel({
				kind: "pi_event",
				payload: { text: "hello" },
				eventId: 2,
			}),
		);
		expect(event.kind).toBe("pi_event");
		expect(event.seq).toBe(2);
	});

	it("maps artifact_written event", () => {
		const sha = "a".repeat(64);
		const event = toRunEventContract(
			makeEventModel({
				kind: "artifact_written",
				payload: { sha256: sha, kind: "input_attachment" },
				eventId: 3,
			}),
		);
		expect(event.kind).toBe("artifact_written");
	});

	it("maps run_done event", () => {
		const event = toRunEventContract(
			makeEventModel({
				kind: "run_done",
				payload: { resultText: "done", stats: {}, artifacts: [] },
				eventId: 4,
			}),
		);
		expect(event.kind).toBe("run_done");
	});

	it("maps run_failed event", () => {
		const event = toRunEventContract(
			makeEventModel({
				kind: "run_failed",
				payload: { error: "oops" },
				eventId: 5,
			}),
		);
		expect(event.kind).toBe("run_failed");
	});

	it("maps interactive transport events", () => {
		const event = toRunEventContract(
			makeEventModel({
				kind: "run_command_queued",
				payload: { seq: 3, kind: "prompt" },
				eventId: 6,
			}),
		);
		expect(event.kind).toBe("run_command_queued");
		expect(event.payload).toEqual({ seq: 3, kind: "prompt" });
	});
});

describe("toRunStateContract", () => {
	it("maps running state without finishedAt", () => {
		const state = toRunStateContract(makeRunModel(), []);
		expect(state.runId).toBe("run-1");
		expect(state.status).toBe("running");
		expect(state.dbosWfId).toBe("wf-1");
		expect(state.finishedAt).toBeUndefined();
	});

	it("includes finishedAt for done status", () => {
		const state = toRunStateContract(
			makeRunModel({ status: "done", updatedAt: "2026-02-28T01:00:00.000Z" }),
			[],
		);
		expect(state.finishedAt).toBe("2026-02-28T01:00:00.000Z");
	});

	it("includes finishedAt for failed status", () => {
		const state = toRunStateContract(
			makeRunModel({
				status: "failed",
				error: "boom",
				updatedAt: "2026-02-28T01:00:00.000Z",
			}),
			[],
		);
		expect(state.finishedAt).toBe("2026-02-28T01:00:00.000Z");
	});

	it("maps artifact links to sha256 pointers", () => {
		const sha = "b".repeat(64);
		const state = toRunStateContract(makeRunModel(), [makeArtifactLink(sha)]);
		expect(state.artifacts).toHaveLength(1);
		expect(state.artifacts[0]?.sha256).toBe(sha);
	});

	it("falls back dbosWfId to runId when workflow id is null", () => {
		const state = toRunStateContract(
			makeRunModel({ dbosWorkflowId: null }),
			[],
		);
		expect(state.dbosWfId).toBe("run-1");
	});

	it("exposes piSessionId and piSessionFile when present", () => {
		const state = toRunStateContract(
			makeRunModel({
				status: "done",
				piSessionId: "sess-1",
				piSessionFile: "s3://bucket/file.jsonl",
			}),
			[],
		);
		expect(state.piSessionId).toBe("sess-1");
		expect(state.piSessionFile).toBe("s3://bucket/file.jsonl");
	});

	it("omits piSessionId and piSessionFile when absent", () => {
		const state = toRunStateContract(makeRunModel(), []);
		expect(state.piSessionId).toBeUndefined();
		expect(state.piSessionFile).toBeUndefined();
	});

	it("projects awaiting_approval for queued runs with pending sandbox approval", () => {
		const state = toRunStateContract(makeRunModel({ status: "queued" }), [], {
			sandbox: {
				runId: "run-1",
				sandboxId: "sbx",
				backend: "docker",
				profile: "priv",
				state: "ready",
				approvalState: "pending",
				spec: {} as never,
				previewSpec: {
					imageDigest: "node:24-alpine",
					profile: "priv",
					network: "egress",
					containerName: "hidden",
					workVolume: "hidden",
					workdir: "/work",
					timeoutSec: 900,
					maxBytesOut: 1024,
					mounts: [],
				},
				containerName: "hidden",
				workVolume: "hidden",
				inflightWorkflowId: null,
				leaseExpiresAt: null,
				createdAt: BASE_TS,
				updatedAt: BASE_TS,
				lastSeenAt: BASE_TS,
			},
		});
		expect(state.status).toBe("awaiting_approval");
	});
});
