import { describe, expect, it } from "vitest";
import {
	ACTOR_API_ENDPOINTS,
	ACTOR_BACKEND_NOUNS,
	ACTOR_CONTRACT_NAMES,
	THREAD_UI_TERMS,
	normalizeMailboxText,
} from "../../apps/api/src/actor";

describe("actor public surface", () => {
	it("freezes backend actor endpoints and actor contract nouns", () => {
		expect(ACTOR_API_ENDPOINTS).toEqual([
			"POST /actors",
			"GET /actors",
			"GET /actors/:actorId",
			"POST /actors/:actorId/messages",
			"GET /actors/:actorId/events",
		]);
		expect(ACTOR_CONTRACT_NAMES).toEqual([
			"ActorSpec",
			"MailboxPost",
			"ActorState",
			"ActorEvent",
		]);
		expect(ACTOR_BACKEND_NOUNS).toEqual(["actor", "mailbox"]);
	});

	it("keeps UI translation at the edge and rejects slash commands", () => {
		expect(THREAD_UI_TERMS).toEqual({
			singular: "thread",
			plural: "threads",
			collection: "inbox",
		});
		expect(normalizeMailboxText(" hello ")).toBe("hello");
		expect(() => normalizeMailboxText(" /help ")).toThrow(
			"mailbox commands are forbidden",
		);
	});
});
