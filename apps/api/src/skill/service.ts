import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { parseSkillInvocation, renderActivatedSkillPrompt } from "./activation";
import {
	type SkillFileReadRequest,
	type SkillFileReadResult,
	readSkillFileRequest,
} from "./lazy";
import { listSkillScriptLinks } from "./paths";
import { buildSkillPreviewSnapshot } from "./preview";
import { SkillRegistry, type SkillRegistryOptions } from "./registry";
import type {
	SkillActivationKind,
	SkillExecutionPlan,
	SkillIndexEntry,
	SkillPreview,
	SkillPreviewRequest,
	SkillPromptResolution,
	SkillRegistryState,
	SkillRoot,
	SkillScope,
} from "./types";
import { buildAvailableSkillsXml } from "./xml";

export type SkillServiceOptions = {
	roots?: SkillRoot[] | undefined;
	prefixBytes?: number | undefined;
	promptMaxSkills?: number | undefined;
	promptMaxDescriptionChars?: number | undefined;
	readPrefix?: SkillRegistryOptions["readPrefix"] | undefined;
	readSkillFile?: ((path: string) => Promise<string>) | undefined;
	readSkillBytes?: ((path: string) => Promise<Buffer>) | undefined;
	cwd?: string | undefined;
	homeDir?: string | undefined;
};

const DEFAULT_PREFIX_BYTES = 8_192;
const DEFAULT_PROMPT_MAX_SKILLS = 128;
const DEFAULT_PROMPT_MAX_DESCRIPTION_CHARS = 240;

/**
 * SkillService is the sole owner of L1 discovery/index/xml semantics.
 * HTTP/run/workflow layers consume only typed projections from this seam.
 */
export class SkillService {
	private readonly registry: SkillRegistry;
	private readonly promptMaxSkills: number;
	private readonly promptMaxDescriptionChars: number;
	private readonly readSkillText: (path: string) => Promise<string>;
	private readonly readSkillBytes: (path: string) => Promise<Buffer>;
	private state: SkillRegistryState = {
		entries: [],
		warnings: [],
	};

	constructor(options: SkillServiceOptions = {}) {
		this.registry = new SkillRegistry({
			roots:
				options.roots ??
				defaultRoots({
					cwd: options.cwd ?? process.cwd(),
					homeDir: options.homeDir ?? homedir(),
				}),
			prefixBytes: options.prefixBytes ?? DEFAULT_PREFIX_BYTES,
			readPrefix: options.readPrefix,
		});
		this.promptMaxSkills = options.promptMaxSkills ?? DEFAULT_PROMPT_MAX_SKILLS;
		this.promptMaxDescriptionChars =
			options.promptMaxDescriptionChars ?? DEFAULT_PROMPT_MAX_DESCRIPTION_CHARS;
		this.readSkillText =
			options.readSkillFile ?? (async (path: string) => readFile(path, "utf8"));
		this.readSkillBytes =
			options.readSkillBytes ?? (async (path: string) => readFile(path));
	}

	async listSkills(): Promise<SkillIndexEntry[]> {
		const state = await this.refresh();
		return state.entries;
	}

	async hasSkill(skillName: string): Promise<boolean> {
		return (await this.lookupSkill(skillName)) != null;
	}

	async buildAvailableSkillsXml(): Promise<string> {
		const state = await this.refresh();
		return buildAvailableSkillsXml(state.entries, {
			maxSkills: this.promptMaxSkills,
			maxDescriptionChars: this.promptMaxDescriptionChars,
		});
	}

	async getRegistryState(): Promise<SkillRegistryState> {
		return this.refresh();
	}

	async resolvePrompt(input: {
		text: string;
		activationKind?: SkillActivationKind | undefined;
	}): Promise<SkillPromptResolution> {
		const invocation = parseSkillInvocation(input.text);
		if (!invocation) {
			return {
				text: input.text,
			};
		}
		const entry = await this.lookupSkill(invocation.skillName);
		if (!entry) {
			throw new Error(`skill not found: ${invocation.skillName}`);
		}
		if ((input.activationKind ?? "explicit") === "implicit" && entry.hidden) {
			throw new Error(`skill is manual-only: ${entry.name}`);
		}
		const skillMarkdown = await this.readSkillText(entry.path);
		const text = renderActivatedSkillPrompt(skillMarkdown, invocation.args);
		return {
			text,
			execution: {
				skillName: entry.name,
				skillPath: entry.path,
				argsText: invocation.args,
				scripts: listSkillScriptLinks(text, dirname(entry.path)),
			} satisfies SkillExecutionPlan,
		};
	}

	async resolvePromptText(input: {
		text: string;
		activationKind?: SkillActivationKind | undefined;
	}): Promise<string> {
		return (await this.resolvePrompt(input)).text;
	}

	async readSkillFile(input: {
		skillName: string;
		request: SkillFileReadRequest;
	}): Promise<SkillFileReadResult | null> {
		const entry = await this.lookupSkill(input.skillName);
		if (!entry) {
			return null;
		}
		return readSkillFileRequest({
			skillPath: entry.path,
			request: input.request,
			readFileBytes: this.readSkillBytes,
		});
	}

	async previewSkill(input: SkillPreviewRequest): Promise<SkillPreview | null> {
		const entry = await this.lookupSkill(input.skillName);
		if (!entry) {
			return null;
		}
		const skillBody = renderActivatedSkillPrompt(
			await this.readSkillText(entry.path),
			input.args?.trim() ?? "",
		);
		const snapshot = await buildSkillPreviewSnapshot({
			skillPath: entry.path,
			skillBody,
		});
		return {
			skillName: entry.name,
			description: entry.description,
			scripts: snapshot.scripts,
			touchedPaths: snapshot.touchedPaths,
			allowedTools: entry.allowedTools,
			manualOnly: entry.hidden,
			menuVisible: entry.menuVisible,
		};
	}

	private async refresh(): Promise<SkillRegistryState> {
		this.state = await this.registry.build();
		return this.state;
	}

	private async lookupSkill(
		skillName: string,
	): Promise<SkillIndexEntry | undefined> {
		const state = await this.refresh();
		return state.entries.find((entry) => entry.name === skillName);
	}
}

export function defaultRoots(input: {
	cwd: string;
	homeDir: string;
}): SkillRoot[] {
	const scoped: Record<SkillScope, string[]> = {
		org: [resolve(input.cwd, ".forkloom/skills/org")],
		workspace: [
			resolve(input.cwd, ".codex/skills"),
			resolve(input.cwd, "skills"),
		],
		user: [
			resolve(input.homeDir, ".codex/skills"),
			resolve(input.homeDir, ".pi/skills"),
			resolve(input.homeDir, ".agents/skills"),
		],
		package: [resolve(input.cwd, "packages/skills")],
		global: ["/etc/forkloom/skills"],
	};
	const roots: SkillRoot[] = [];
	for (const [scope, paths] of Object.entries(scoped)) {
		for (const path of paths) {
			roots.push({ scope: scope as SkillScope, path });
		}
	}
	return roots;
}

export const defaultSkillRoots = defaultRoots;
