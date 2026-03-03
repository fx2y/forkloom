export const REQUIRED_THEME_VAR_KEYS = ["primary", "secondary"] as const;
export const REQUIRED_THEME_COLOR_KEYS = [
	"accent",
	"border",
	"text",
	"error",
	"success",
	"bashMode",
] as const;

export type ThemeVarKey = (typeof REQUIRED_THEME_VAR_KEYS)[number];
export type ThemeColorKey = (typeof REQUIRED_THEME_COLOR_KEYS)[number];

export type ThemeVars = Record<ThemeVarKey, string | number>;
export type ThemeColors = Record<ThemeColorKey, string>;

export type ThemeDefinition = {
	$schema?: string | undefined;
	name: string;
	vars: ThemeVars;
	colors: ThemeColors;
};

export type ThemeValidationResult =
	| { ok: true; theme: ThemeDefinition }
	| { ok: false; errors: string[] };

export type ThemeCandidate = {
	name: string;
	path: string;
	source: "builtin" | "global" | "project" | "package" | "settings" | "cli";
};

export type ThemeResolveInput = {
	candidates: ThemeCandidate[];
	settingsTheme?: string | undefined;
	cliTheme?: string | undefined;
	disableThemes?: boolean | undefined;
};
