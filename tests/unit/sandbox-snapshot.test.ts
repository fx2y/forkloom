import { describe, expect, it } from "vitest";
import {
	buildWorkspaceManifest,
	isDurableWorkspacePath,
} from "../../apps/api/src/sandbox/snapshot";

describe("sandbox snapshot policy", () => {
	it("filters cache-like workspace paths", () => {
		expect(isDurableWorkspacePath("project/src/index.ts")).toBe(true);
		expect(isDurableWorkspacePath("node_modules/pkg/index.js")).toBe(false);
		expect(isDurableWorkspacePath(".tmp/log.txt")).toBe(false);
	});

	it("builds a sorted manifest of durable entries only", () => {
		const manifest = buildWorkspaceManifest([
			{ path: "z.txt", bytes: 1, sha256: "z".repeat(64) },
			{ path: "node_modules/x.js", bytes: 2, sha256: "n".repeat(64) },
			{ path: "a.txt", bytes: 3, sha256: "a".repeat(64) },
		]);

		expect(manifest.entries.map((entry) => entry.path)).toEqual([
			"a.txt",
			"z.txt",
		]);
	});
});
