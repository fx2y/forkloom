import { describe, expect, it } from "vitest";
import { validateArtifactMeta } from "../../packages/contracts/src/validate";

describe("Artifact.meta contract", () => {
	it("accepts namespaced keys", () => {
		const result = validateArtifactMeta({
			"ingest.note": "ok",
			"source-file.name": "README.md",
		});
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});

	it("rejects non-namespaced keys", () => {
		const result = validateArtifactMeta({ BadKey: "x" });
		expect(result.valid).toBe(false);
		expect(result.errors.join("; ")).toContain("property name");
	});
});
