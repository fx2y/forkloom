import { describe, expect, it } from "vitest";
import {
	hydrateRunState,
	initialRunViewState,
	reduceRunEvent,
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
});
