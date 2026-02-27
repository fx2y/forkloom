import { describe, expect, it } from "vitest";
import {
	initialRunViewState,
	reduceRunEvent,
	replayRunEvents,
} from "./reducer";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";

describe("run event reducer", () => {
	it("derives final view state from append-only events", () => {
		const events = [
			{
				runId: RUN_ID,
				seq: 1,
				t: "2026-02-27T00:00:00.000Z",
				kind: "run_started",
				payload: {},
			},
			{
				runId: RUN_ID,
				seq: 2,
				t: "2026-02-27T00:00:01.000Z",
				kind: "artifact_written",
				payload: {
					sha256: "a".repeat(64),
					kind: "input_attachment",
				},
			},
			{
				runId: RUN_ID,
				seq: 3,
				t: "2026-02-27T00:00:02.000Z",
				kind: "run_done",
				payload: {
					text: "done",
					artifacts: ["b".repeat(64)],
				},
			},
		] as const;

		const state = replayRunEvents([...events]);

		expect(state.status).toBe("done");
		expect(state.resultText).toBe("done");
		expect(state.artifacts.map((artifact) => artifact.sha256)).toEqual([
			"a".repeat(64),
			"b".repeat(64),
		]);
	});

	it("ignores replayed duplicate sequence numbers", () => {
		const started = {
			runId: RUN_ID,
			seq: 1,
			t: "2026-02-27T00:00:00.000Z",
			kind: "run_started",
			payload: {},
		} as const;

		const once = reduceRunEvent(initialRunViewState, started);
		const twice = reduceRunEvent(once, started);

		expect(twice.trace).toHaveLength(1);
		expect(twice.lastSeq).toBe(1);
	});
});
