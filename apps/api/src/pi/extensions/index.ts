export {
	discoverExtensionFiles,
	defaultExtensionRoots,
	defaultExtensionSettingsFiles,
} from "./discovery";
export { ExtensionService } from "./service";
export type { ExtensionServiceOptions } from "./service";
export { createBranchStateLog } from "./state-log";
export type {
	ExtensionApi,
	ExtensionCommandDefinition,
	ExtensionDiscovered,
	ExtensionDiscoveryOptions,
	ExtensionHookHandler,
	ExtensionHookName,
	ExtensionHookPayloadMap,
	ExtensionHostHooks,
	ExtensionModuleExport,
	ExtensionProviderDefinition,
	ExtensionReloadStatus,
	ExtensionRuntimeSnapshot,
	ExtensionToolCallDecision,
	ExtensionToolDefinition,
	ExtensionUi,
} from "./types";
