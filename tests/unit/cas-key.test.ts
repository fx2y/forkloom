import { describe, expect, it } from "vitest";
import { casKey } from "../../packages/shared/src/hash";

describe("casKey", () => {
	it("fans out using first two hex chars", () => {
		const sha = `aaff${"0".repeat(60)}`;
		expect(casKey(sha)).toBe(`cas/aa/${sha}`);
	});
});
