import {
	readPackageSettingsFile,
	writePackageSettingsFile,
} from "./settings";
import type { PackageInventoryRecord } from "./types";

export function resourceStateKey(input: {
	identity: string;
	kind: string;
	path: string;
}): string {
	return `${input.identity}#${input.kind}#${input.path}`;
}

export function projectActiveResources(input: {
	inventory: PackageInventoryRecord[];
	resourceState: Record<string, boolean>;
}): PackageInventoryRecord[] {
	return input.inventory.filter((record) => {
		const key = resourceStateKey({
			identity: record.packageIdentity,
			kind: record.kind,
			path: record.path,
		});
		return input.resourceState[key] !== false;
	});
}

export async function setResourceEnabled(input: {
	settingsPath: string;
	identity: string;
	kind: string;
	path: string;
	enabled: boolean;
}): Promise<void> {
	const model = await readPackageSettingsFile(input.settingsPath);
	const key = resourceStateKey(input);
	const nextState = { ...(model.resourceState ?? {}) };
	nextState[key] = input.enabled;
	await writePackageSettingsFile({
		path: input.settingsPath,
		model: {
			...model,
			resourceState: nextState,
		},
	});
}
