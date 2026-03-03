import type { MergedPackageSettingsEntry } from "./types";

export type StartupReconcileResult = {
	attempts: number;
	installed: string[];
	remainingMissing: string[];
};

export async function reconcileMissingPackages(input: {
	entries: MergedPackageSettingsEntry[];
	isInstalled: (entry: MergedPackageSettingsEntry) => Promise<boolean>;
	install: (entry: MergedPackageSettingsEntry) => Promise<void>;
	maxRetries?: number | undefined;
	pollMs?: number | undefined;
}): Promise<StartupReconcileResult> {
	const maxRetries = input.maxRetries ?? 3;
	const pollMs = input.pollMs ?? 250;
	const installed = new Set<string>();

	for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
		const missing: MergedPackageSettingsEntry[] = [];
		for (const entry of [...input.entries].sort((a, b) =>
			a.identity.localeCompare(b.identity),
		)) {
			if (await input.isInstalled(entry)) {
				continue;
			}
			missing.push(entry);
		}
		if (missing.length === 0) {
			return {
				attempts: attempt,
				installed: [...installed].sort((a, b) => a.localeCompare(b)),
				remainingMissing: [],
			};
		}
		for (const entry of missing) {
			await input.install(entry);
			installed.add(entry.identity);
		}
		if (attempt < maxRetries) {
			await new Promise((resolve) => setTimeout(resolve, pollMs));
		}
	}

	const remainingMissing: string[] = [];
	for (const entry of input.entries) {
		if (!(await input.isInstalled(entry))) {
			remainingMissing.push(entry.identity);
		}
	}
	remainingMissing.sort((a, b) => a.localeCompare(b));
	return {
		attempts: maxRetries,
		installed: [...installed].sort((a, b) => a.localeCompare(b)),
		remainingMissing,
	};
}
