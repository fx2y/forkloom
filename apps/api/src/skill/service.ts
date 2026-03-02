import { homedir } from "node:os";
import { resolve } from "node:path";
import { SkillRegistry, type SkillRegistryOptions } from "./registry";
import type {
	SkillIndexEntry,
	SkillPreview,
	SkillPreviewRequest,
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
	}

	async listSkills(): Promise<SkillIndexEntry[]> {
		const state = await this.refresh();
		return state.entries;
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

	async previewSkill(
		_input: SkillPreviewRequest,
	): Promise<SkillPreview | null> {
		return null;
	}

	private async refresh(): Promise<SkillRegistryState> {
		this.state = await this.registry.build();
		return this.state;
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
