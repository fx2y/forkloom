import type { ExtensionProviderDefinition } from "../extensions";

export type ProviderOverrideValue = {
	provider?: string | undefined;
	model?: string | undefined;
	extraEnv?: NodeJS.ProcessEnv | undefined;
	homeOverride?: string | undefined;
};

export type ProviderOverride = {
	name: string;
	ownerId: string;
	value: ProviderOverrideValue;
};

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

function asStringRecord(value: unknown): NodeJS.ProcessEnv | undefined {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const out: NodeJS.ProcessEnv = {};
	for (const [key, raw] of Object.entries(value)) {
		if (typeof raw !== "string") {
			continue;
		}
		out[key] = raw;
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

export function parseProviderOverride(
	definition: ExtensionProviderDefinition,
): ProviderOverrideValue | null {
	if (definition.value == null || typeof definition.value !== "object") {
		return null;
	}
	const value = definition.value as Record<string, unknown>;
	const parsed: ProviderOverrideValue = {
		provider: asString(value.provider),
		model: asString(value.model),
		extraEnv: asStringRecord(value.extraEnv),
		homeOverride: asString(value.homeOverride),
	};
	if (
		parsed.provider == null &&
		parsed.model == null &&
		parsed.extraEnv == null &&
		parsed.homeOverride == null
	) {
		return null;
	}
	return parsed;
}

export function buildProviderOverrideRegistry(input: {
	providers: Array<{
		ownerId: string;
		definition: ExtensionProviderDefinition;
	}>;
	onWarning?: ((message: string) => void) | undefined;
}): Map<string, ProviderOverride> {
	const out = new Map<string, ProviderOverride>();
	for (const entry of input.providers) {
		const parsed = parseProviderOverride(entry.definition);
		if (!parsed) {
			continue;
		}
		if (out.has(entry.definition.name)) {
			const existing = out.get(entry.definition.name);
			input.onWarning?.(
				`provider override collision (${entry.definition.name}): keep ${existing?.ownerId}, ignore ${entry.ownerId}`,
			);
			continue;
		}
		out.set(entry.definition.name, {
			name: entry.definition.name,
			ownerId: entry.ownerId,
			value: parsed,
		});
	}
	return out;
}

export function resolveProviderOverride(input: {
	provider: string;
	model: string;
	extraEnv?: NodeJS.ProcessEnv | undefined;
	homeOverride?: string | undefined;
	overrides?: Map<string, ProviderOverride> | undefined;
}): {
	provider: string;
	model: string;
	extraEnv?: NodeJS.ProcessEnv | undefined;
	homeOverride?: string | undefined;
} {
	const override = input.overrides?.get(input.provider);
	if (!override) {
		return {
			provider: input.provider,
			model: input.model,
			extraEnv: input.extraEnv,
			homeOverride: input.homeOverride,
		};
	}
	return {
		provider: override.value.provider ?? input.provider,
		model: override.value.model ?? input.model,
		extraEnv: {
			...(input.extraEnv ?? {}),
			...(override.value.extraEnv ?? {}),
		},
		homeOverride: override.value.homeOverride ?? input.homeOverride,
	};
}
