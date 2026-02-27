export const PI_COMMANDS = [
	"prompt",
	"steer",
	"follow_up",
	"abort",
	"get_state",
	"get_last_assistant_text",
	"get_session_stats",
] as const;

export type PiCommand = (typeof PI_COMMANDS)[number];

export { PiRpcClient, spawnPiRpcProcess } from "./rpc-client";
export type {
	PiRpcEvent,
	PiRpcPayload,
	PiRpcProcess,
	PiRpcResponse,
	SpawnPiRpcInput,
} from "./rpc-client";
export { MockPiProviderManager } from "./mock-provider";
export type { MockPiProviderLease } from "./mock-provider";
export { createPiSessionPort, RpcPiSessionPort } from "./session-port";
export type {
	CreatePiSessionInput,
	PiImageInput,
	PiPromptInput,
	PiSessionPort,
	PiSessionState,
	PiSessionStats,
	PiStreamingBehavior,
} from "./session-port";
export {
	createManagedPiSessionFactory,
	probePiSession,
} from "./session-factory";
export type { ManagedPiSessionOverrides } from "./session-factory";
