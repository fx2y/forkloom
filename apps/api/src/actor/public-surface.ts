export const ACTOR_API_ENDPOINTS = [
	"POST /actors",
	"GET /actors",
	"GET /actors/:actorId",
	"POST /actors/:actorId/messages",
	"GET /actors/:actorId/events",
] as const;

export const ACTOR_CONTRACT_NAMES = [
	"ActorSpec",
	"MailboxPost",
	"ActorState",
	"ActorEvent",
] as const;

export const ACTOR_BACKEND_NOUNS = ["actor", "mailbox"] as const;

export const THREAD_UI_TERMS = {
	singular: "thread",
	plural: "threads",
	collection: "inbox",
} as const;
