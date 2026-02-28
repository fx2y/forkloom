import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type RunSandboxFilesProof = {
	runId: string;
	runState: {
		status: string;
		preview: { profile: string };
		files: { entries: Array<{ path: string }> };
	};
	files: {
		workspaceRef?: { sha256: string };
		workspace_manifest: {
			entries: Array<{ path: string; bytes: number; sha256: string }>;
		};
	};
};

describe("run sandbox files proof", () => {
	it("asserts preview/files routes read durable state", () => {
		const proofPath = ".cache/test-int/run-sandbox-files.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/run-sandbox-files.json; run `MISE_EXPERIMENTAL=1 mise run test:int:run-sandbox-files` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<RunSandboxFilesProof>;

		expect(typeof parsed.runId).toBe("string");
		expect(parsed.runState?.status).toBe("awaiting_approval");
		expect(parsed.runState?.preview.profile).toBe("priv");
		expect(parsed.runState?.files.entries[0]?.path).toBe("project/proof.txt");
		expect(parsed.files?.workspaceRef?.sha256).toBe("a".repeat(64));
		expect(parsed.files?.workspace_manifest.entries[0]).toEqual({
			path: "project/proof.txt",
			bytes: 12,
			sha256: "b".repeat(64),
		});
	});
});
