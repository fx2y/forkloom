import {
	REQUIRED_THEME_COLOR_KEYS,
	REQUIRED_THEME_VAR_KEYS,
	type ThemeColors,
	type ThemeDefinition,
	type ThemeValidationResult,
	type ThemeVars,
} from "./types";

function asRecord(value: unknown, label: string): Record<string, unknown> {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be object`);
	}
	return value as Record<string, unknown>;
}

function asNonEmptyString(value: unknown, label: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${label} invalid`);
	}
	return value.trim();
}

function toThemeVars(value: unknown): ThemeVars {
	const record = asRecord(value, "vars");
	for (const key of REQUIRED_THEME_VAR_KEYS) {
		const token = record[key];
		if (typeof token !== "string" && typeof token !== "number") {
			throw new Error(`vars.${key} invalid`);
		}
	}
	return {
		primary: record.primary as string | number,
		secondary: record.secondary as string | number,
	};
}

function toThemeColors(value: unknown): ThemeColors {
	const record = asRecord(value, "colors");
	for (const key of REQUIRED_THEME_COLOR_KEYS) {
		const token = record[key];
		if (typeof token !== "string") {
			throw new Error(`colors.${key} invalid`);
		}
	}
	return {
		accent: record.accent as string,
		border: record.border as string,
		text: record.text as string,
		error: record.error as string,
		success: record.success as string,
		bashMode: record.bashMode as string,
	};
}

export function validateTheme(value: unknown): ThemeValidationResult {
	try {
		const root = asRecord(value, "theme");
		const theme: ThemeDefinition = {
			$schema:
				typeof root.$schema === "string" ? root.$schema.trim() : undefined,
			name: asNonEmptyString(root.name, "name"),
			vars: toThemeVars(root.vars),
			colors: toThemeColors(root.colors),
		};
		return { ok: true, theme };
	} catch (error) {
		return {
			ok: false,
			errors: [error instanceof Error ? error.message : String(error)],
		};
	}
}

export function parseTheme(value: unknown): ThemeDefinition {
	const out = validateTheme(value);
	if (!out.ok) {
		throw new Error(`theme invalid: ${out.errors.join("; ")}`);
	}
	return out.theme;
}
