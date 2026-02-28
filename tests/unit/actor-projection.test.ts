import { describe, expect, it } from "vitest";
import {
	toActorEventContract,
	toActorStateContract,
} from "../../apps/api/src/actor";
import type {
	ActorEventModel,
	ActorStateModel,
} from "../../apps/api/src/actor";

describe("actor projection", () => {
	it("maps actor state to the public v1 contract", () => {
		const state: ActorStateModel = {
			actorId: "actor-1",
			name: "ops",
			status: "idle",
			mailboxCursor: 4,
			nextMailboxSeq: 5,
			inflightWorkflowId: null,
			piSessionId: "sess-1",
			piSessionFile: "s3://cas/session",
			memRef: null,
			workspaceId: null,
			updatedAt: "2026-02-28T00:00:00.000Z",
		};

		expect(toActorStateContract(state)).toEqual({
			actorId: "actor-1",
			name: "ops",
			status: "idle",
			mailboxCursor: 4,
			updatedAt: "2026-02-28T00:00:00.000Z",
		});
	});

	it("maps actor event rows to the public v1 contract", () => {
		const event: ActorEventModel = {
			eventId: 3,
			actorId: "actor-1",
			seq: 3,
			kind: "mailbox_processed",
			payload: { seq: 2 },
			createdAt: "2026-02-28T00:00:00.000Z",
		};

		expect(toActorEventContract(event)).toEqual({
			actorId: "actor-1",
			seq: 3,
			t: "2026-02-28T00:00:00.000Z",
			kind: "mailbox_processed",
			payload: { seq: 2 },
		});
	});
});
