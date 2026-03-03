import { readFile } from "node:fs/promises";
import { resolveActiveTheme, sortThemeCandidates } from "./discovery";
import { parseTheme } from "./schema";
import type {
	ThemeCandidate,
	ThemeDefinition,
	ThemeResolveInput,
} from "./types";
import { type ActiveThemeWatcher, watchActiveThemeFile } from "./watch";

export type ThemeServiceOptions = {
	readText?: ((path: string) => Promise<string>) | undefined;
	watchFile?:
		| ((input: {
				path: string;
				onReload: () => Promise<void> | void;
		  }) => ActiveThemeWatcher)
		| undefined;
};

export type ThemeRuntimeSnapshot = {
	activeThemeName: string | null;
	activeThemePath: string | null;
	candidateNames: string[];
};

export class ThemeService {
	private readonly readText: (path: string) => Promise<string>;
	private readonly watchFile: (input: {
		path: string;
		onReload: () => Promise<void> | void;
	}) => ActiveThemeWatcher;
	private candidates: ThemeCandidate[] = [];
	private resolveInput: Omit<ThemeResolveInput, "candidates"> = {};
	private active: ThemeCandidate | null = null;
	private activeTheme: ThemeDefinition | null = null;
	private watcher: ActiveThemeWatcher | null = null;

	constructor(options: ThemeServiceOptions = {}) {
		this.readText = options.readText ?? ((path) => readFile(path, "utf8"));
		this.watchFile = options.watchFile ?? watchActiveThemeFile;
	}

	setCandidates(candidates: ThemeCandidate[]): void {
		this.candidates = sortThemeCandidates(candidates);
	}

	setSelection(input: {
		settingsTheme?: string | undefined;
		cliTheme?: string | undefined;
		disableThemes?: boolean | undefined;
	}): void {
		this.resolveInput = input;
	}

	getActiveTheme(): ThemeDefinition | null {
		return this.activeTheme;
	}

	getSnapshot(): ThemeRuntimeSnapshot {
		return {
			activeThemeName: this.active?.name ?? null,
			activeThemePath: this.active?.path ?? null,
			candidateNames: this.candidates.map((candidate) => candidate.name),
		};
	}

	async reloadSelection(): Promise<ThemeDefinition | null> {
		const selected = resolveActiveTheme({
			...this.resolveInput,
			candidates: this.candidates,
		});
		if (!selected) {
			this.clearActiveWatcher();
			this.active = null;
			this.activeTheme = null;
			return null;
		}
		const parsed = await this.loadThemeFile(selected.path);
		this.active = selected;
		this.activeTheme = parsed;
		this.resetActiveWatcher(selected.path);
		return parsed;
	}

	close(): void {
		this.clearActiveWatcher();
	}

	private async loadThemeFile(path: string): Promise<ThemeDefinition> {
		const text = await this.readText(path);
		let payload: unknown;
		try {
			payload = JSON.parse(text);
		} catch (error) {
			throw new Error(
				`theme invalid: parse failed (${path}): ${String(error)}`,
			);
		}
		return parseTheme(payload);
	}

	private resetActiveWatcher(path: string): void {
		this.clearActiveWatcher();
		this.watcher = this.watchFile({
			path,
			onReload: async () => {
				if (!this.active || this.active.path !== path) {
					return;
				}
				this.activeTheme = await this.loadThemeFile(path);
			},
		});
	}

	private clearActiveWatcher(): void {
		this.watcher?.close();
		this.watcher = null;
	}
}
