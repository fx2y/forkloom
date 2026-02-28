import type { ActorEvent, ActorState } from "@forkloom/contracts";
import { describe, expect, it } from "vitest";
import {
	deriveThreadPresence,
	listInboxThreads,
	replayActorEvents,
	summarizeThread,
} from "./actor-reducer";

const ACTOR: ActorState = {
	actorId: "ops",
	name: "Ops",
	status: "idle",
	mailboxCursor: 0,
	updatedAt: "2026-02-28T00:00:00.000Z",
};

describe("actor reducer", () => {
	it("replays append-only events into truthful assistant text and resources", () => {
		const events: ActorEvent[] = [
			{
				actorId: "ops",
				seq: 1,
				t: "2026-02-28T00:00:01.000Z",
				kind: "mailbox_queued",
				payload: { seq: 4, kind: "prompt" },
			},
			{
				actorId: "ops",
				seq: 2,
				t: "2026-02-28T00:00:02.000Z",
				kind: "session_bound",
				payload: {
					seq: 4,
					sessionId: "s-1",
					sessionFile: "/tmp/pi/session-1.jsonl",
				},
			},
			{
				actorId: "ops",
				seq: 3,
				t: "2026-02-28T00:00:03.000Z",
				kind: "pi_event",
				payload: {
					seq: 4,
					event: {
						kind: "tool_call",
					},
					artifacts: ["a".repeat(64)],
				},
			},
			{
				actorId: "ops",
				seq: 4,
				t: "2026-02-28T00:00:04.000Z",
				kind: "mailbox_processed",
				payload: {
					seq: 4,
					kind: "prompt",
					sessionId: "s-1",
					sessionFile: "/tmp/pi/session-1.jsonl",
					lastAssistantText: "answer ready",
					attachments: [{ sha256: "a".repeat(64) }],
				},
			},
		];

		const thread = replayActorEvents(ACTOR, events);

		expect(thread.latestAssistantText).toBe("answer ready");
		expect(thread.artifacts).toEqual([
			{
				key: "session:/tmp/pi/session-1.jsonl",
				label: "session-1.jsonl",
				kind: "session",
			},
			{
				key: `sha256:${"a".repeat(64)}`,
				label: "aaaaaaaaaaaa",
				kind: "artifact",
				href: `/artifacts/${"a".repeat(64)}`,
			},
		]);
		expect(deriveThreadPresence(thread)).toBe("idle");
		expect(thread.pendingMailboxSeqs).toEqual([]);
	});

	it("does not invent assistant text and keeps streaming truth from queued mail", () => {
		const thread = replayActorEvents(ACTOR, [
			{
				actorId: "ops",
				seq: 1,
				t: "2026-02-28T00:00:01.000Z",
				kind: "mailbox_queued",
				payload: { seq: 7, kind: "prompt" },
			},
			{
				actorId: "ops",
				seq: 2,
				t: "2026-02-28T00:00:02.000Z",
				kind: "pi_event",
				payload: {
					seq: 7,
					event: { kind: "assistant_delta", text: "partial" },
				},
			},
		]);

		expect(thread.latestAssistantText).toBe("");
		expect(deriveThreadPresence(thread)).toBe("streaming");
		expect(summarizeThread(thread).preview).toBe("assistant_delta");
	});

	it("sorts inbox by latest activity", () => {
		const newer = replayActorEvents(
			{
				...ACTOR,
				actorId: "build",
				name: "Build",
			},
			[
				{
					actorId: "build",
					seq: 1,
					t: "2026-02-28T00:00:05.000Z",
					kind: "mailbox_processed",
					payload: {
						seq: 1,
						kind: "prompt",
						lastAssistantText: "done",
					},
				},
			],
		);
		const older = replayActorEvents(ACTOR, []);

		expect(
			listInboxThreads({
				selectedActorId: "ops",
				threads: {
					ops: older,
					build: newer,
				},
			}).map((thread) => thread.actor.actorId),
		).toEqual(["build", "ops"]);
	});
});
