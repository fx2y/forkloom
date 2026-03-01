import { describe, expect, it } from "vitest";
import { buildStepHashes } from "../../apps/api/src/workflow/step-hash";

describe("buildStepHashes", () => {
	it("produces deterministic values for equivalent envelopes", () => {
		const base = {
			runId: "run-1",
			stepName: "run_command",
			attempt: 3,
			command: {
				runId: "run-1",
				seq: 3,
				kind: "prompt" as const,
				payload: { text: "hello", mode: "x" },
				dedupeKey: null,
				state: "done" as const,
				claimedBy: "wf",
				claimedAt: "2026-03-01T00:00:00.000Z",
				leaseExpiresAt: "2026-03-01T00:01:00.000Z",
				doneAt: "2026-03-01T00:00:05.000Z",
				error: null,
				createdAt: "2026-03-01T00:00:00.000Z",
			},
			exec: {
				exitCode: 0,
				status: "done" as const,
				cmdList: ["prompt", "hello"],
				artifactReads: [{ sha256: "c".repeat(64) }, { sha256: "a".repeat(64) }],
				artifactWrites: [
					{ sha256: "f".repeat(64) },
					{ sha256: "b".repeat(64) },
				],
				stdoutTail: "",
				stderrTail: "",
				stdoutBytes: 0,
				stderrBytes: 0,
				timeoutSec: 30,
				maxBytesOut: 4096,
				stdoutRef: { sha256: "d".repeat(64) },
				stderrRef: { sha256: "e".repeat(64) },
				workspaceRef: { sha256: "1".repeat(64) },
				startedAt: "2026-03-01T00:00:00.000Z",
				endedAt: "2026-03-01T00:00:01.000Z",
			},
			sessionEntryIds: ["s3", "s1", "s2", "s1"],
		};
		const first = buildStepHashes(base);
		const second = buildStepHashes({
			...base,
			sessionEntryIds: ["s2", "s1", "s3"],
			exec: {
				...base.exec,
				artifactReads: [{ sha256: "a".repeat(64) }, { sha256: "c".repeat(64) }],
				artifactWrites: [
					{ sha256: "b".repeat(64) },
					{ sha256: "f".repeat(64) },
				],
			},
		});

		expect(second.inHash).toBe(first.inHash);
		expect(second.outHash).toBe(first.outHash);
		expect(second.stepKey).toBe(first.stepKey);
	});

	it("changes in causal inputs change inHash and stepKey", () => {
		const one = buildStepHashes({
			runId: "run-1",
			stepName: "run_command",
			attempt: 1,
			command: {
				runId: "run-1",
				seq: 1,
				kind: "prompt",
				payload: { text: "one" },
				dedupeKey: null,
				state: "done",
				claimedBy: null,
				claimedAt: null,
				leaseExpiresAt: null,
				doneAt: null,
				error: null,
				createdAt: "2026-03-01T00:00:00.000Z",
			},
			exec: {
				exitCode: 0,
				status: "done",
				cmdList: ["prompt", "one"],
				artifactReads: [{ sha256: "a".repeat(64) }],
				artifactWrites: [],
				stdoutTail: "",
				stderrTail: "",
				stdoutBytes: 0,
				stderrBytes: 0,
				timeoutSec: 30,
				maxBytesOut: 4096,
				startedAt: "2026-03-01T00:00:00.000Z",
				endedAt: "2026-03-01T00:00:01.000Z",
			},
			sessionEntryIds: ["s1"],
		});
		const two = buildStepHashes({
			runId: "run-1",
			stepName: "run_command",
			attempt: 1,
			command: {
				runId: "run-1",
				seq: 1,
				kind: "prompt",
				payload: { text: "one" },
				dedupeKey: null,
				state: "done",
				claimedBy: null,
				claimedAt: null,
				leaseExpiresAt: null,
				doneAt: null,
				error: null,
				createdAt: "2026-03-01T00:00:00.000Z",
			},
			exec: {
				exitCode: 0,
				status: "done",
				cmdList: ["prompt", "one"],
				artifactReads: [{ sha256: "b".repeat(64) }],
				artifactWrites: [],
				stdoutTail: "",
				stderrTail: "",
				stdoutBytes: 0,
				stderrBytes: 0,
				timeoutSec: 30,
				maxBytesOut: 4096,
				startedAt: "2026-03-01T00:00:00.000Z",
				endedAt: "2026-03-01T00:00:01.000Z",
			},
			sessionEntryIds: ["s1"],
		});

		expect(two.inHash).not.toBe(one.inHash);
		expect(two.stepKey).not.toBe(one.stepKey);
	});
});
