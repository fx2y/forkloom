import type { Skill as SkillManifestV0 } from "@forkloom/contracts";

export type SkillManifest = SkillManifestV0;

export type SkillScope = "org" | "workspace" | "user" | "package" | "global";

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
