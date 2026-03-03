export const PI_COMMANDS = [
	"prompt",
	"steer",
	"follow_up",
	"set_follow_up_mode",
	"set_steering_mode",
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
export {
	createPiSessionPort,
	RpcPiSessionPort,
	waitForPiIdle,
} from "./session-port";
export type {
	CreatePiSessionInput,
	PiImageInput,
	PiPromptInput,
	PiQueueMode,
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
export {
	assertToolCallResultAdjacency,
	parseSessionJsonl,
} from "./session-index";
export type { SessionIndexSummary, SessionTreeIndex } from "./session-index";
export {
	discoverExtensionFiles,
	defaultExtensionRoots,
	defaultExtensionSettingsFiles,
	ExtensionService,
	createBranchStateLog,
} from "./extensions";
export {
	applyFilterRules,
	buildPackageResourceRegistry,
	loadMergedPackageSettings,
	mergeByIdentity,
	parsePackageManifest,
	parsePackageSettingsText,
	PackageOps,
	projectActiveResources,
	readPackageSettingsFile,
	reconcileMissingPackages,
	resolvePackageSource,
	setResourceEnabled,
	writePackageSettingsFile,
} from "./packages";
export {
	resolveActiveTheme,
	sortThemeCandidates,
	parseTheme,
	validateTheme,
	ThemeService,
	watchActiveThemeFile,
} from "./themes";
export {
	buildProviderOverrideRegistry,
	parseProviderOverride,
	resolveProviderOverride,
} from "./providers";
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
	ExtensionServiceOptions,
	ExtensionToolCallDecision,
	ExtensionToolDefinition,
	ExtensionUi,
} from "./extensions";
export type {
	MergedPackageSettingsEntry,
	PackageFilterRules,
	PackageInventoryRecord,
	PackageManifestDescriptor,
	PackageResourceKind,
	PackageScope,
	PackageSettingsEntry,
	PackageSettingsModel,
	ResolvedPackageSource,
} from "./packages";
export type {
	ThemeCandidate,
	ThemeColorKey,
	ThemeDefinition,
	ThemeResolveInput,
	ThemeRuntimeSnapshot,
	ThemeServiceOptions,
	ThemeValidationResult,
	ThemeVarKey,
} from "./themes";
export type { ProviderOverride, ProviderOverrideValue } from "./providers";
