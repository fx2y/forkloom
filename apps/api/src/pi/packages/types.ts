export type PackageResourceKind = "extensions" | "skills" | "prompts" | "themes";

export const PACKAGE_RESOURCE_KINDS: PackageResourceKind[] = [
	"extensions",
	"skills",
	"prompts",
	"themes",
];

export type PackageScope = "global" | "project";

export type PackageSettingsEntry = {
	source: string;
	extensions?: string[] | undefined;
	skills?: string[] | undefined;
	prompts?: string[] | undefined;
	themes?: string[] | undefined;
};

export type PackageSettingsModel = {
	packages: PackageSettingsEntry[];
	resourceState?: Record<string, boolean> | undefined;
};

export type ResolvedPackageSource =
	| {
			kind: "npm";
			source: string;
			identity: string;
			packageName: string;
			version: string | null;
			pinned: boolean;
	  }
	| {
			kind: "git";
			source: string;
			identity: string;
			url: string;
			ref: string | null;
			pinned: boolean;
	  }
	| {
			kind: "local";
			source: string;
			identity: string;
			path: string;
			pinned: false;
	  };

export type MergedPackageSettingsEntry = PackageSettingsEntry & {
	identity: string;
	scope: PackageScope;
	settingsFile: string;
	resolved: ResolvedPackageSource;
};

export type PackageFilterRules = {
	extensions?: string[] | undefined;
	skills?: string[] | undefined;
	prompts?: string[] | undefined;
	themes?: string[] | undefined;
};

export type PackageManifestDescriptor = {
	packageRoot: string;
	packageName: string;
	version: string;
	resources: Record<PackageResourceKind, string[]>;
};

export type PackageInventoryRecord = {
	packageIdentity: string;
	packageScope: PackageScope;
	packageRoot: string;
	kind: PackageResourceKind;
	path: string;
};
