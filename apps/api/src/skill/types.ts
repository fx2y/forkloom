import type { Skill as SkillManifestV0 } from "@forkloom/contracts";

export type SkillManifest = SkillManifestV0;

export type SkillScope = "org" | "workspace" | "user" | "package" | "global";

export const SKILL_SCOPE_PRECEDENCE = [
	"org",
	"workspace",
	"user",
	"package",
	"global",
] as const satisfies readonly SkillScope[];

export type SkillRoot = {
	scope: SkillScope;
	path: string;
};

export type SkillFrontmatterRaw = Partial<{
	name: unknown;
	description: unknown;
	version: unknown;
	"allowed-tools": unknown;
	"disable-model-invocation": unknown;
	"user-invocable": unknown;
}>;

export type SkillFrontmatter = {
	name?: string | undefined;
	description?: string | undefined;
	version?: SkillManifest["version"] | undefined;
	allowedTools?: SkillManifest["allowedTools"] | undefined;
	disableModelInvocation: boolean;
	userInvocable: boolean;
};

export type SkillIndexEntry = {
	skillId: SkillManifest["skillId"];
	name: SkillManifest["name"];
	description: SkillManifest["description"];
	path: SkillManifest["path"];
	scope: SkillScope;
	hidden: boolean;
	menuVisible: boolean;
	allowedTools?: SkillManifest["allowedTools"];
	version?: SkillManifest["version"];
	hash: string;
};

export type SkillPreviewRequest = {
	skillName: string;
	args?: string | undefined;
};

export type SkillPreview = {
	skillName: SkillIndexEntry["name"];
	description: SkillIndexEntry["description"];
	scripts: string[];
	touchedPaths: string[];
	allowedTools?: SkillManifest["allowedTools"];
	manualOnly: boolean;
	menuVisible: boolean;
};

export type SkillRegistryWarningCode =
	| "collision"
	| "description_missing"
	| "description_len"
	| "frontmatter_missing"
	| "name_chars"
	| "name_dir_mismatch"
	| "name_double_dash"
	| "name_len"
	| "read_error";

export type SkillRegistryWarning = {
	code: SkillRegistryWarningCode;
	message: string;
	path: string;
	scope: SkillScope;
	name?: string | undefined;
	existingPath?: string | undefined;
};

export type SkillRegistryState = {
	entries: SkillIndexEntry[];
	warnings: SkillRegistryWarning[];
};
