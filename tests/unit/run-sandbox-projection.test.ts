import { describe, expect, it } from "vitest";
import {
	toRunEventContract,
	toRunStateContract,
} from "../../apps/api/src/run/projection";

const ISO = "2026-02-28T00:00:00.000Z";

describe("run sandbox projection", () => {
	it("projects preview, approval, command, and files without leaking sandbox internals", () => {
		const state = toRunStateContract(
			{
				runId: "run-1",
				status: "running",
				spec: {
					runId: "run-1",
					scope: "team",
					userMsg: "hi",
					attachments: [],
				},
				createdAt: ISO,
				updatedAt: ISO,
				dbosWorkflowId: "wf-1",
				piSessionId: null,
				piSessionFile: null,
				resultText: null,
				resultStats: null,
				error: null,
			},
			[],
			{
				sandbox: {
					runId: "run-1",
					sandboxId: "sbx",
					backend: "docker",
					profile: "safe",
					state: "ready",
					approvalState: "approved",
					spec: {} as never,
					previewSpec: {
						imageDigest: "node:24-alpine",
						profile: "safe",
						network: "off",
						containerName: "hidden",
						workVolume: "hidden",
						workdir: "/work",
						timeoutSec: 900,
						maxBytesOut: 1024,
						mounts: [
							{
								source: "/secret",
								dest: "/inputs",
								mode: "ro",
								kind: "inputs",
							},
						],
					},
					containerName: "hidden",
					workVolume: "hidden",
					inflightWorkflowId: null,
					leaseExpiresAt: null,
					createdAt: ISO,
					updatedAt: ISO,
					lastSeenAt: ISO,
				},
				currentCommand: {
					runId: "run-1",
					seq: 7,
					kind: "followUp",
					payload: {},
					dedupeKey: null,
					state: "queued",
					claimedBy: null,
					claimedAt: null,
					leaseExpiresAt: null,
					doneAt: null,
					error: null,
					createdAt: ISO,
				},
				files: {
					workspaceRef: { sha256: "a".repeat(64) },
					workspace_manifest: {
						version: 1,
						entries: [
							{ path: "project/keep.txt", bytes: 4, sha256: "b".repeat(64) },
						],
					},
				},
			},
		) as Record<string, unknown>;

		expect((state.preview as Record<string, unknown>).profile).toBe("safe");
		expect(
			(state.preview as Record<string, unknown>).containerName,
		).toBeUndefined();
		expect((state.approval as Record<string, unknown>).state).toBe("approved");
		expect((state.currentCommand as Record<string, unknown>).kind).toBe(
			"followUp",
		);
		expect(
			(state.files as Record<string, unknown>).entries as unknown[],
		).toHaveLength(1);
	});

	it("projects aborted when the latest durable command is an abort", () => {
		const state = toRunStateContract(
			{
				runId: "run-1",
				status: "failed",
				spec: {
					runId: "run-1",
					scope: "team",
					userMsg: "hi",
					attachments: [],
				},
				createdAt: ISO,
				updatedAt: ISO,
				dbosWorkflowId: "wf-1",
				piSessionId: null,
				piSessionFile: null,
				resultText: null,
				resultStats: null,
				error: "aborted by user",
			},
			[],
			{
				currentCommand: {
					runId: "run-1",
					seq: 9,
					kind: "abort",
					payload: {},
					dedupeKey: null,
					state: "done",
					claimedBy: "wf-1",
					claimedAt: ISO,
					leaseExpiresAt: null,
					doneAt: ISO,
					error: null,
					createdAt: ISO,
				},
			},
		);

		expect(state.status).toBe("aborted");
	});

	it("maps additive run sandbox events through the replay seam", () => {
		const event = toRunEventContract({
			eventId: 9,
			runId: "run-1",
			kind: "run_previewed",
			payload: { preview: { profile: "safe" } },
			createdAt: ISO,
		});

		expect(event.kind).toBe("run_previewed");
		expect(event.seq).toBe(9);
	});
});
