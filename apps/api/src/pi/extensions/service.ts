import { pathToFileURL } from "node:url";
import { discoverExtensionFiles } from "./discovery";
import {
	EXTENSION_HOOK_NAMES,
	type ExtensionApi,
	type ExtensionCommandDefinition,
	type ExtensionDiscovered,
	type ExtensionDiscoveryOptions,
	type ExtensionHookName,
	type ExtensionHookPayloadMap,
	type ExtensionHostHooks,
	type ExtensionModuleDispose,
	type ExtensionModuleNamespace,
	type ExtensionProviderDefinition,
	type ExtensionReloadStatus,
	type ExtensionRuntimeSnapshot,
	type ExtensionStateEntry,
	type ExtensionToolCallDecision,
	type ExtensionToolDefinition,
	type ExtensionUi,
} from "./types";

export type ExtensionServiceOptions = {
	discovery?: ExtensionDiscoveryOptions | undefined;
	discover?:
		| ((options: ExtensionDiscoveryOptions) => Promise<ExtensionDiscovered>)
		| undefined;
	loadModule?:
		| ((path: string, nonce: number) => Promise<ExtensionModuleNamespace>)
		| undefined;
	hasUI?: boolean | undefined;
	ui?: Partial<ExtensionUi> | undefined;
	now?: (() => string) | undefined;
};

type RegisteredTool = {
	ownerId: string;
	definition: ExtensionToolDefinition;
};

type RegisteredCommand = {
	ownerId: string;
	name: string;
	definition: ExtensionCommandDefinition;
};

type RegisteredProvider = {
	ownerId: string;
	definition: ExtensionProviderDefinition;
};

type RegisteredHook = {
	ownerId: string;
	handler: AnyHookHandler;
};

type AnyHookHandler = (payload: unknown) => Promise<unknown> | unknown;

type ExtensionModuleState = {
	id: string;
	path: string;
	tools: Map<string, ExtensionToolDefinition>;
	commands: Map<string, ExtensionCommandDefinition>;
	providers: Map<string, ExtensionProviderDefinition>;
	hooks: Map<ExtensionHookName, AnyHookHandler[]>;
	entries: ExtensionStateEntry[];
	dispose?: (() => Promise<void>) | undefined;
	active: boolean;
	committed: boolean;
};

const HOOK_SET = new Set<string>(EXTENSION_HOOK_NAMES);

function normalizeCommandName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length === 0) {
		throw new Error("extension command name must be non-empty");
	}
	return trimmed;
}

function validateName(name: string, label: string): string {
	const trimmed = name.trim();
	if (trimmed.length === 0) {
		throw new Error(`${label} name must be non-empty`);
	}
	return trimmed;
}

function resolveDisposer(
	value: ExtensionModuleDispose | undefined,
): (() => Promise<void>) | undefined {
	if (!value) {
		return undefined;
	}
	if (typeof value === "function") {
		return async () => {
			await value();
		};
	}
	if (typeof value.dispose === "function") {
		return async () => {
			await value.dispose?.();
		};
	}
	return undefined;
}

async function defaultLoadModule(
	path: string,
	nonce: number,
): Promise<ExtensionModuleNamespace> {
	const url = new URL(pathToFileURL(path).href);
	url.searchParams.set("forkloom_ext", String(nonce));
	const loaded = await import(url.href);
	return loaded as ExtensionModuleNamespace;
}

function createUi(input: {
	hasUI: boolean;
	ui?: Partial<ExtensionUi> | undefined;
}): ExtensionUi {
	const uiDisabled = () => {
		throw new Error("ctx.ui is unavailable in headless mode");
	};
	if (!input.hasUI) {
		return {
			notify: uiDisabled,
			confirm: async () => {
				uiDisabled();
				return false;
			},
			input: async () => {
				uiDisabled();
				return undefined;
			},
			setStatus: uiDisabled,
			setWidget: uiDisabled,
		};
	}
	return {
		notify: input.ui?.notify ?? (() => undefined),
		confirm: input.ui?.confirm ?? (async () => true),
		input: input.ui?.input ?? (async () => undefined),
		setStatus: input.ui?.setStatus ?? (() => undefined),
		setWidget: input.ui?.setWidget ?? (() => undefined),
	};
}

/**
 * ExtensionService owns deterministic extension discovery/load/reload and
 * exposes a minimal hook surface to run workflows.
 */
export class ExtensionService implements ExtensionHostHooks {
	private readonly discoverFn: (
		options: ExtensionDiscoveryOptions,
	) => Promise<ExtensionDiscovered>;
	private readonly loadModuleFn: (
		path: string,
		nonce: number,
	) => Promise<ExtensionModuleNamespace>;
	private readonly discoveryOptions: ExtensionDiscoveryOptions;
	private readonly now: () => string;
	private readonly hasUI: boolean;
	private readonly ui: ExtensionUi;
	private readonly modules: ExtensionModuleState[] = [];
	private readonly toolRegistry = new Map<string, RegisteredTool>();
	private readonly commandRegistry = new Map<string, RegisteredCommand>();
	private readonly providerRegistry = new Map<string, RegisteredProvider>();
	private readonly hookRegistry = new Map<
		ExtensionHookName,
		RegisteredHook[]
	>();
	private warnings: string[] = [];
	private lastDiscovery: ExtensionDiscovered = {
		files: [],
		warnings: [],
		roots: [],
		settingsFiles: [],
	};
	private nonce = 0;

	constructor(options: ExtensionServiceOptions = {}) {
		this.discoveryOptions = options.discovery ?? {};
		this.discoverFn = options.discover ?? discoverExtensionFiles;
		this.loadModuleFn = options.loadModule ?? defaultLoadModule;
		this.now = options.now ?? (() => new Date().toISOString());
		this.hasUI = options.hasUI ?? false;
		this.ui = createUi({ hasUI: this.hasUI, ui: options.ui });
		for (const hookName of EXTENSION_HOOK_NAMES) {
			this.hookRegistry.set(hookName, []);
		}
	}

	async loadAll(): Promise<ExtensionRuntimeSnapshot> {
		if (this.modules.length > 0) {
			return this.getSnapshot();
		}
		const discovered = await this.discoverFn(this.discoveryOptions);
		this.lastDiscovery = discovered;
		this.warnings = [...discovered.warnings];
		await this.loadDiscovered(discovered.files);
		return this.getSnapshot();
	}

	async reload(): Promise<ExtensionReloadStatus> {
		const previous = this.modules.map((module) => module.path);
		const discovered = await this.discoverFn(this.discoveryOptions);
		this.lastDiscovery = discovered;
		this.warnings = [...discovered.warnings];
		await this.unloadAll();
		try {
			await this.loadDiscovered(discovered.files);
			return {
				reloaded: true,
				discovered: discovered.files.length,
				loaded: this.modules.length,
				warnings: [...this.warnings],
			};
		} catch (error) {
			this.warnings.push(`reload failed: ${String(error)}`);
			await this.unloadAll();
			if (previous.length > 0) {
				try {
					await this.loadDiscovered(previous);
				} catch (restoreError) {
					throw new Error(
						`extension reload failed and restore failed: ${String(restoreError)}`,
					);
				}
			}
			throw error;
		}
	}

	async unloadAll(): Promise<void> {
		const reversed = [...this.modules].reverse();
		for (const module of reversed) {
			module.active = false;
			if (!module.dispose) {
				continue;
			}
			try {
				await module.dispose();
			} catch (error) {
				this.warnings.push(`dispose failed (${module.path}): ${String(error)}`);
			}
		}
		this.clearRegistries();
	}

	getSnapshot(): ExtensionRuntimeSnapshot {
		const entryCount = this.modules.reduce(
			(total, module) => total + module.entries.length,
			0,
		);
		const hookCount = [...this.hookRegistry.values()].reduce(
			(total, handlers) => total + handlers.length,
			0,
		);
		return {
			discoveredFiles: [...this.lastDiscovery.files],
			loadedExtensionIds: this.modules.map((module) => module.id),
			toolNames: [...this.toolRegistry.keys()].sort((a, b) =>
				a.localeCompare(b),
			),
			commandNames: [...this.commandRegistry.keys()].sort((a, b) =>
				a.localeCompare(b),
			),
			providerNames: [...this.providerRegistry.keys()].sort((a, b) =>
				a.localeCompare(b),
			),
			entryCount,
			hookCount,
			warnings: [...this.warnings],
		};
	}

	async emitSessionStart(
		payload: ExtensionHookPayloadMap["session_start"],
	): Promise<void> {
		await this.emit("session_start", payload);
	}

	async emitBeforeAgentStart(
		payload: ExtensionHookPayloadMap["before_agent_start"],
	): Promise<ExtensionHookPayloadMap["before_agent_start"]> {
		const next = { ...payload };
		for (const entry of this.hookRegistry.get("before_agent_start") ?? []) {
			const result = await entry.handler(next as never);
			if (result && typeof result === "object") {
				const value = (result as { text?: unknown }).text;
				if (typeof value === "string") {
					next.text = value;
				}
			}
		}
		return next;
	}

	async emitContext(
		payload: ExtensionHookPayloadMap["context"],
	): Promise<ExtensionHookPayloadMap["context"]> {
		const next = { ...payload };
		for (const entry of this.hookRegistry.get("context") ?? []) {
			const result = await entry.handler(next as never);
			if (result && typeof result === "object") {
				const value = (result as { text?: unknown }).text;
				if (typeof value === "string") {
					next.text = value;
				}
			}
		}
		return next;
	}

	async emitToolCall(
		payload: ExtensionHookPayloadMap["tool_call"],
	): Promise<ExtensionToolCallDecision> {
		let blocked = false;
		let reason: string | undefined;
		for (const entry of this.hookRegistry.get("tool_call") ?? []) {
			const result = await entry.handler(payload as never);
			if (!result || typeof result !== "object") {
				continue;
			}
			const decision = result as { block?: unknown; reason?: unknown };
			if (decision.block === true && !blocked) {
				blocked = true;
				reason =
					typeof decision.reason === "string" && decision.reason.length > 0
						? decision.reason
						: undefined;
			}
		}
		return {
			blocked,
			reason,
		};
	}

	async emitToolResult(
		payload: ExtensionHookPayloadMap["tool_result"],
	): Promise<void> {
		await this.emit("tool_result", payload);
	}

	async emitSessionTree(
		payload: ExtensionHookPayloadMap["session_tree"],
	): Promise<void> {
		await this.emit("session_tree", payload);
	}

	async emitSessionFork(
		payload: ExtensionHookPayloadMap["session_fork"],
	): Promise<void> {
		await this.emit("session_fork", payload);
	}

	getRegisteredProviders(): Array<{
		ownerId: string;
		definition: ExtensionProviderDefinition;
	}> {
		return [...this.providerRegistry.values()].map((entry) => ({
			ownerId: entry.ownerId,
			definition: entry.definition,
		}));
	}

	private clearRegistries(): void {
		this.modules.length = 0;
		this.toolRegistry.clear();
		this.commandRegistry.clear();
		this.providerRegistry.clear();
		for (const hookName of EXTENSION_HOOK_NAMES) {
			this.hookRegistry.set(hookName, []);
		}
	}

	private async loadDiscovered(files: string[]): Promise<void> {
		for (const path of files) {
			await this.loadOne(path);
		}
	}

	private ensureModuleActive(module: ExtensionModuleState): void {
		if (!module.active) {
			throw new Error(
				`extension ${module.id} is inactive; registration is not allowed`,
			);
		}
	}

	private createApi(module: ExtensionModuleState): ExtensionApi {
		return {
			registerTool: (definition) => {
				this.ensureModuleActive(module);
				const name = validateName(definition.name, "tool");
				if (module.tools.has(name)) {
					throw new Error(`tool already registered in ${module.id}: ${name}`);
				}
				module.tools.set(name, {
					...definition,
					name,
				});
				if (module.committed) {
					this.attachTool(
						module.id,
						module.tools.get(name) as ExtensionToolDefinition,
					);
				}
			},
			registerCommand: (name, definition) => {
				this.ensureModuleActive(module);
				const commandName = normalizeCommandName(name);
				if (module.commands.has(commandName)) {
					throw new Error(
						`command already registered in ${module.id}: ${commandName}`,
					);
				}
				module.commands.set(commandName, definition);
				if (module.committed) {
					this.attachCommand(module.id, commandName, definition);
				}
			},
			registerProvider: (definition) => {
				this.ensureModuleActive(module);
				const name = validateName(definition.name, "provider");
				if (module.providers.has(name)) {
					throw new Error(
						`provider already registered in ${module.id}: ${name}`,
					);
				}
				const normalized = {
					...definition,
					name,
				};
				module.providers.set(name, normalized);
				if (module.committed) {
					this.attachProvider(module.id, normalized);
				}
			},
			appendEntry: (value) => {
				this.ensureModuleActive(module);
				module.entries.push({
					ts: this.now(),
					value,
				});
			},
			on: (event, handler) => {
				this.ensureModuleActive(module);
				if (!HOOK_SET.has(event)) {
					throw new Error(`unsupported extension hook: ${event}`);
				}
				const list = module.hooks.get(event) ?? [];
				list.push(handler as AnyHookHandler);
				module.hooks.set(event, list);
				if (module.committed) {
					this.attachHook(module.id, event, handler as AnyHookHandler);
				}
			},
			hasUI: this.hasUI,
			ui: this.ui,
		};
	}

	private async loadOne(path: string): Promise<void> {
		this.nonce += 1;
		const loaded = await this.loadModuleFn(path, this.nonce);
		if (!loaded || typeof loaded.default !== "function") {
			throw new Error(`extension ${path} must default-export a function`);
		}
		const moduleState: ExtensionModuleState = {
			id: path,
			path,
			tools: new Map(),
			commands: new Map(),
			providers: new Map(),
			hooks: new Map(),
			entries: [],
			active: true,
			committed: false,
		};
		const api = this.createApi(moduleState);
		const dispose = await loaded.default(api);
		moduleState.dispose = resolveDisposer(dispose);
		this.commit(moduleState);
	}

	private commit(module: ExtensionModuleState): void {
		module.committed = true;
		this.modules.push(module);
		for (const tool of module.tools.values()) {
			this.attachTool(module.id, tool);
		}
		for (const [name, command] of module.commands) {
			this.attachCommand(module.id, name, command);
		}
		for (const provider of module.providers.values()) {
			this.attachProvider(module.id, provider);
		}
		for (const [name, handlers] of module.hooks) {
			for (const handler of handlers) {
				this.attachHook(module.id, name, handler);
			}
		}
	}

	private attachTool(
		ownerId: string,
		definition: ExtensionToolDefinition,
	): void {
		if (this.toolRegistry.has(definition.name)) {
			const existing = this.toolRegistry.get(definition.name);
			this.warnings.push(
				`tool collision (${definition.name}): keep ${existing?.ownerId}, ignore ${ownerId}`,
			);
			return;
		}
		this.toolRegistry.set(definition.name, {
			ownerId,
			definition,
		});
	}

	private attachCommand(
		ownerId: string,
		name: string,
		definition: ExtensionCommandDefinition,
	): void {
		if (this.commandRegistry.has(name)) {
			const existing = this.commandRegistry.get(name);
			this.warnings.push(
				`command collision (${name}): keep ${existing?.ownerId}, ignore ${ownerId}`,
			);
			return;
		}
		this.commandRegistry.set(name, {
			ownerId,
			name,
			definition,
		});
	}

	private attachProvider(
		ownerId: string,
		definition: ExtensionProviderDefinition,
	): void {
		if (this.providerRegistry.has(definition.name)) {
			const existing = this.providerRegistry.get(definition.name);
			this.warnings.push(
				`provider collision (${definition.name}): keep ${existing?.ownerId}, ignore ${ownerId}`,
			);
			return;
		}
		this.providerRegistry.set(definition.name, {
			ownerId,
			definition,
		});
	}

	private attachHook(
		ownerId: string,
		name: ExtensionHookName,
		handler: AnyHookHandler,
	): void {
		const list = this.hookRegistry.get(name) ?? [];
		list.push({ ownerId, handler });
		this.hookRegistry.set(name, list);
	}

	private async emit<K extends ExtensionHookName>(
		name: K,
		payload: ExtensionHookPayloadMap[K],
	): Promise<Array<unknown>> {
		const handlers = this.hookRegistry.get(name) ?? [];
		const results: unknown[] = [];
		for (const entry of handlers) {
			results.push(await entry.handler(payload as never));
		}
		return results;
	}
}
