import { describe, expect, it } from "vitest";
import {
	artifactSetFromReplayPayloads,
	assertEqualShaSets,
	listReplayStepPayloads,
	readReplayConfig,
	selectReplayStepPayload,
} from "../../apps/api/src/workflow/replay";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
const ISO = "2026-02-28T00:00:00.000Z";

describe("replay workflow helpers", () => {
	it("reads replay config from env flags", () => {
		const replay = readReplayConfig({
			REPLAY_RUN_ID: RUN_ID,
			REPLAY_MODE: "debug",
			REPLAY_ATTEMPT: "3",
		});
		expect(replay).toEqual({
			enabled: true,
			sourceRunId: RUN_ID,
			mode: "debug",
			attempt: 3,
		});
	});

	it("parses run_command payloads and builds artifact sets", () => {
		const parsed = listReplayStepPayloads([
			{
				runId: RUN_ID,
				stepName: "run_command",
				attempt: 2,
				payload: {
					commandSeq: 2,
					commandKind: "prompt",
					commandPayload: { text: "hi" },
					exec: {
						exitCode: 0,
						status: "done",
						startedAt: ISO,
						endedAt: ISO,
						cmdList: ["prompt", "hi"],
						artifactReads: [{ sha256: "a".repeat(64) }],
						artifactWrites: [{ sha256: "b".repeat(64) }],
					},
					session: {
						sessionId: "session-1",
						sessionFile: "/tmp/s.jsonl",
						sessionArtifactSha: "c".repeat(64),
						sessionEntryIds: ["entry-1"],
						entryCount: 1,
						summaryEntryCount: 0,
					},
				},
				createdAt: ISO,
			},
		]);

		expect(parsed).toHaveLength(1);
		expect(selectReplayStepPayload(parsed, 2)?.commandKind).toBe("prompt");
		expect([...artifactSetFromReplayPayloads(parsed)].sort()).toEqual([
			"b".repeat(64),
			"c".repeat(64),
		]);
	});

	it("fails replay compare on set drift", () => {
		expect(() =>
			assertEqualShaSets(new Set(["a".repeat(64)]), new Set(["b".repeat(64)])),
		).toThrow("artifact drift");
	});
});
