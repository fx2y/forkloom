export {
	ACTOR_API_ENDPOINTS,
	ACTOR_BACKEND_NOUNS,
	ACTOR_CONTRACT_NAMES,
	THREAD_UI_TERMS,
} from "./public-surface";
export {
	ActorService,
	normalizeMailboxText,
} from "./service";
export type { ActorServiceDeps } from "./service";
export { ACTOR_MAILBOX_KINDS, ACTOR_STATUSES } from "./ports";
export type * from "./ports";
