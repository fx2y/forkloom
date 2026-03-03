import {
	loadMergedPackageSettings,
	readPackageSettingsFile,
	writePackageSettingsFile,
} from "./settings";
import { resolvePackageSource } from "./resolver";
import type { MergedPackageSettingsEntry, PackageScope } from "./types";

function scopePath(input: {
	scope: PackageScope;
	globalSettingsPath: string;
	projectSettingsPath: string;
}): string {
	return input.scope === "project"
		? input.projectSettingsPath
		: input.globalSettingsPath;
}

export class PackageOps {
	constructor(
		private readonly settingsPaths: {
			globalSettingsPath: string;
			projectSettingsPath: string;
		},
	) {}

	async list(): Promise<MergedPackageSettingsEntry[]> {
		const loaded = await loadMergedPackageSettings(this.settingsPaths);
		return loaded.merged;
	}

	async install(input: {
		source: string;
		scope?: PackageScope | undefined;
	}): Promise<{ changed: boolean; identity: string }> {
		const scope = input.scope ?? "global";
		const settingsPath = scopePath({
			scope,
			...this.settingsPaths,
		});
		const model = await readPackageSettingsFile(settingsPath);
		const resolved = await resolvePackageSource({
			source: input.source,
			settingsFile: settingsPath,
		});
		const filtered = [];
		let replacedIdentity = false;
		let alreadyExact = false;
		for (const entry of model.packages) {
			const current = await resolvePackageSource({
				source: entry.source,
				settingsFile: settingsPath,
			});
			if (current.identity === resolved.identity) {
				replacedIdentity = true;
				if (entry.source.trim() === input.source.trim()) {
					alreadyExact = true;
				}
				continue;
			}
			filtered.push(entry);
		}
		filtered.push({ source: input.source.trim() });
		filtered.sort((left, right) => left.source.localeCompare(right.source));
		model.packages = filtered;
		await writePackageSettingsFile({
			path: settingsPath,
			model,
		});
		return {
			changed: !alreadyExact || !replacedIdentity,
			identity: resolved.identity,
		};
	}

	async remove(input: {
		source: string;
		scope?: PackageScope | undefined;
	}): Promise<{ changed: boolean }> {
		const scope = input.scope ?? "global";
		const settingsPath = scopePath({
			scope,
			...this.settingsPaths,
		});
		const model = await readPackageSettingsFile(settingsPath);
		const resolved = await resolvePackageSource({
			source: input.source,
			settingsFile: settingsPath,
		});
		const next = [];
		let changed = false;
		for (const entry of model.packages) {
			const current = await resolvePackageSource({
				source: entry.source,
				settingsFile: settingsPath,
			});
			if (current.identity === resolved.identity) {
				changed = true;
				continue;
			}
			next.push(entry);
		}
		if (changed) {
			model.packages = next;
			await writePackageSettingsFile({ path: settingsPath, model });
		}
		return { changed };
	}

	async update(input?: {
		scope?: PackageScope | undefined;
		onUpdate?:
			| ((entry: MergedPackageSettingsEntry) => Promise<string | null>)
			| undefined;
	}): Promise<{ updated: string[]; skippedPinned: string[] }> {
		const entries = await this.list();
		const filtered = entries.filter((entry) =>
			input?.scope ? entry.scope === input.scope : true,
		);
		const updated: string[] = [];
		const skippedPinned: string[] = [];
		for (const entry of filtered) {
			if (entry.resolved.pinned) {
				skippedPinned.push(entry.identity);
				continue;
			}
			if (!input?.onUpdate) {
				continue;
			}
			const nextSource = await input.onUpdate(entry);
			if (!nextSource || nextSource === entry.source) {
				continue;
			}
			const model = await readPackageSettingsFile(entry.settingsFile);
			model.packages = model.packages.map((pkg) =>
				pkg.source === entry.source ? { ...pkg, source: nextSource } : pkg,
			);
			await writePackageSettingsFile({
				path: entry.settingsFile,
				model,
			});
			updated.push(entry.identity);
		}
		updated.sort((left, right) => left.localeCompare(right));
		skippedPinned.sort((left, right) => left.localeCompare(right));
		return { updated, skippedPinned };
	}
}
