import type { PackageInventoryRecord, PackageManifestDescriptor } from "./types";

export function buildPackageResourceRegistry(input: {
	descriptors: Array<{
		packageIdentity: string;
		packageScope: "global" | "project";
		manifest: PackageManifestDescriptor;
	}>;
}): PackageInventoryRecord[] {
	const out: PackageInventoryRecord[] = [];
	const seen = new Set<string>();
	const sortedDescriptors = [...input.descriptors].sort((left, right) => {
		if (left.packageScope !== right.packageScope) {
			return left.packageScope === "project" ? -1 : 1;
		}
		return left.packageIdentity.localeCompare(right.packageIdentity);
	});

	for (const descriptor of sortedDescriptors) {
		for (const [kind, paths] of Object.entries(descriptor.manifest.resources)) {
			for (const path of paths) {
				const key = `${kind}:${path}`;
				if (seen.has(key)) {
					continue;
				}
				seen.add(key);
				out.push({
					packageIdentity: descriptor.packageIdentity,
					packageScope: descriptor.packageScope,
					packageRoot: descriptor.manifest.packageRoot,
					kind: kind as PackageInventoryRecord["kind"],
					path,
				});
			}
		}
	}
	out.sort((left, right) => {
		const kindCmp = left.kind.localeCompare(right.kind);
		if (kindCmp !== 0) {
			return kindCmp;
		}
		return left.path.localeCompare(right.path);
	});
	return out;
}
