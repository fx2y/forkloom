import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type BoundaryProof = {
	zero: {
		sha256: string;
		bytes: number;
	};
	large: {
		sha256: string;
		bytes: number;
	};
	byteaColumns: Array<{ table_name: string; column_name: string }>;
};

describe("artifact boundary live proof", () => {
	it("asserts zero-byte and 100MB uploads succeed with pointer-only DB storage", () => {
		const proofPath = ".cache/test-int/artifact-boundaries.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/test-int/artifact-boundaries.json; run `MISE_EXPERIMENTAL=1 mise run test:int:artifact-boundaries` first",
			);
		}

		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<BoundaryProof>;

		expect(parsed.zero?.sha256).toHaveLength(64);
		expect(parsed.zero?.bytes).toBe(0);
		expect(parsed.large?.sha256).toHaveLength(64);
		expect(parsed.large?.bytes).toBe(100 * 1024 * 1024);
		expect(parsed.byteaColumns).toEqual([]);
	});
});
