export const EXTENSION_HOOK_NAMES = [
	"session_start",
	"before_agent_start",
	"context",
	"tool_call",
	"tool_result",
	"session_tree",
	"session_fork",
	"session_before_compact",
] as const;

export type ExtensionHookName = (typeof EXTENSION_HOOK_NAMES)[number];

export type ExtensionStateEntry = {
	ts: string;
	value: unknown;
};

export type ExtensionToolDefinition = {
	name: string;
	label?: string | undefined;
	description?: string | undefined;
	parameters?: unknown;
	execute?: ((input: unknown) => Promise<unknown> | unknown) | undefined;
};

export type ExtensionCommandDefinition = {
	description: string;
	handler: (input: {
		args: string[];
		runId?: string | undefined;
	}) => Promise<unknown> | unknown;
};

export type ExtensionProviderDefinition = {
	name: string;
	value: unknown;
};

export type ExtensionUi = {
	notify(message: string): void;
	confirm(message: string): Promise<boolean>;
	input(message: string): Promise<string | undefined>;
	setStatus(key: string, message: string): void;
	setWidget(key: string, lines: string[]): void;
};

export type ExtensionHookPayloadMap = {
	session_start: {
		runId: string;
		sessionId?: string | undefined;
	};
	before_agent_start: {
		runId: string;
		commandKind: "prompt" | "followUp" | "steer";
		text: string;
	};
	context: {
		runId: string;
		commandKind: "prompt" | "followUp" | "steer";
		text: string;
	};
	tool_call: {
		runId: string;
		toolName: string;
		commandKind: string;
		input: Record<string, unknown>;
	};
	tool_result: {
		runId: string;
		toolName: string;
		commandKind: string;
		result: Record<string, unknown>;
	};
	session_tree: {
		runId: string;
		sessionId?: string | undefined;
	};
	session_fork: {
		runId: string;
		sessionId?: string | undefined;
	};
	session_before_compact: {
		runId: string;
		sessionId?: string | undefined;
	};
};

export type ExtensionHookResultMap = {
	session_start: undefined;
	before_agent_start: { text?: string | undefined } | undefined;
	context: { text?: string | undefined } | undefined;
	tool_call:
		| { block?: boolean | undefined; reason?: string | undefined }
		| undefined;
	tool_result: undefined;
	session_tree: undefined;
	session_fork: undefined;
	session_before_compact: undefined;
};

export type ExtensionHookHandler<K extends ExtensionHookName> = (
	payload: ExtensionHookPayloadMap[K],
) => Promise<ExtensionHookResultMap[K]> | ExtensionHookResultMap[K];

export type ExtensionApi = {
	registerTool(definition: ExtensionToolDefinition): void;
	registerCommand(name: string, definition: ExtensionCommandDefinition): void;
	registerProvider(definition: ExtensionProviderDefinition): void;
	appendEntry(value: unknown): void;
	on<K extends ExtensionHookName>(
		event: K,
		handler: ExtensionHookHandler<K>,
	): void;
	hasUI: boolean;
	ui: ExtensionUi;
};

export type ExtensionModuleDispose =
	| (() => Promise<void> | void)
	| {
			dispose?: (() => Promise<void> | void) | undefined;
	  };

export type ExtensionModuleExport = (
	api: ExtensionApi,
) =>
	| Promise<ExtensionModuleDispose | undefined>
	| ExtensionModuleDispose
	| undefined;

export type ExtensionModuleNamespace = {
	default?: ExtensionModuleExport | undefined;
};

export type ExtensionDiscovered = {
	files: string[];
	warnings: string[];
	roots: string[];
	settingsFiles: string[];
};

export type ExtensionDiscoveryOptions = {
	roots?: string[] | undefined;
	settingsFiles?: string[] | undefined;
	cwd?: string | undefined;
	homeDir?: string | undefined;
};

export type ExtensionRuntimeSnapshot = {
	discoveredFiles: string[];
	loadedExtensionIds: string[];
	toolNames: string[];
	commandNames: string[];
	providerNames: string[];
	entryCount: number;
	hookCount: number;
	warnings: string[];
};

export type ExtensionReloadStatus = {
	reloaded: boolean;
	discovered: number;
	loaded: number;
	warnings: string[];
};

export type ExtensionToolCallDecision = {
	blocked: boolean;
	reason?: string | undefined;
};

export type ExtensionHostHooks = {
	emitSessionStart(
		payload: ExtensionHookPayloadMap["session_start"],
	): Promise<void>;
	emitBeforeAgentStart(
		payload: ExtensionHookPayloadMap["before_agent_start"],
	): Promise<ExtensionHookPayloadMap["before_agent_start"]>;
	emitContext(
		payload: ExtensionHookPayloadMap["context"],
	): Promise<ExtensionHookPayloadMap["context"]>;
	emitToolCall(
		payload: ExtensionHookPayloadMap["tool_call"],
	): Promise<ExtensionToolCallDecision>;
	emitToolResult(
		payload: ExtensionHookPayloadMap["tool_result"],
	): Promise<void>;
};
