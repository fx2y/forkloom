import { describe, expect, it } from "vitest";
import {
	RUN_API_ENDPOINTS,
	RUN_PUBLIC_BANNED_SANDBOX_NOUNS,
	RUN_PUBLIC_COMMAND_KINDS,
	RUN_PUBLIC_EVENT_KINDS_FROZEN_NEXT,
	RUN_PUBLIC_OWNERSHIP_NOTE,
	RUN_PUBLIC_STATE_FIELDS_FROZEN_NEXT,
	RUN_PUBLIC_STATUSES_FROZEN_NEXT,
	RUN_PUBLIC_TOP_LEVEL_NOUNS,
} from "../../apps/api/src/run/public-surface";

describe("run public surface freeze", () => {
	it("keeps the public owner on /runs", () => {
		expect(RUN_API_ENDPOINTS).toEqual([
			"POST /runs",
			"GET /runs/:runId",
			"GET /runs/:runId/truth",
			"GET /runs/:runId/events",
			"POST /runs/:runId/commands",
			"GET /runs/:runId/files",
			"POST /runs/:runId/files/export",
		]);
	});

	it("keeps top-level nouns run-owned and bans sandbox nouns", () => {
		expect(RUN_PUBLIC_TOP_LEVEL_NOUNS).toEqual([
			"RunSpec",
			"RunState",
			"RunEvent",
			"TruthBundle",
		]);
		expect(RUN_PUBLIC_BANNED_SANDBOX_NOUNS).toEqual([
			"SandboxSpec",
			"SandboxState",
			"SandboxEvent",
			"SandboxCommand",
		]);
	});

	it("pins the future interactive delta before schema work", () => {
		expect(RUN_PUBLIC_COMMAND_KINDS).toEqual([
			"approve",
			"prompt",
			"followUp",
			"steer",
			"abort",
		]);
		expect(RUN_PUBLIC_STATUSES_FROZEN_NEXT).toEqual([
			"awaiting_approval",
			"aborted",
		]);
		expect(RUN_PUBLIC_EVENT_KINDS_FROZEN_NEXT).toEqual([
			"run_previewed",
			"run_approval_required",
			"run_approved",
			"run_command_queued",
			"run_aborted",
			"workspace_updated",
		]);
		expect(RUN_PUBLIC_STATE_FIELDS_FROZEN_NEXT).toEqual([
			"preview",
			"approval",
			"currentCommand",
			"files",
		]);
		expect(RUN_PUBLIC_OWNERSHIP_NOTE.join(" ")).toContain(
			"sandbox stays internal",
		);
	});
});
