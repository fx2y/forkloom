import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type OpsSqlPack = {
	status: "ok" | "fail";
	recentRuns: unknown[];
	driftRows: unknown[];
	targetRunId: string | null;
	targetRunExists: boolean;
	failures: Array<{ code: string; detail: string }>;
};

describe("ops sql pack", () => {
	it("emits executable operator query output", () => {
		const proofPath = ".cache/spec06/ops-sql-pack.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/spec06/ops-sql-pack.json; run `MISE_EXPERIMENTAL=1 mise run test:int:ops-sql` first",
			);
		}
		const parsed = JSON.parse(readFileSync(proofPath, "utf8")) as OpsSqlPack;
		expect(parsed.status).toBe("ok");
		expect(Array.isArray(parsed.recentRuns)).toBe(true);
		expect(parsed.recentRuns.length).toBeGreaterThan(0);
		expect(Array.isArray(parsed.driftRows)).toBe(true);
		expect(parsed.targetRunId).not.toBeNull();
		expect(parsed.targetRunExists).toBe(true);
		expect(parsed.failures).toEqual([]);
	});
});
