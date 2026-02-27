import { describe, expect, it } from "vitest";
import fixture from "../../fixtures/contract/pi-event.valid.json" with {
	type: "json",
};
import { validatePiSessionEvent } from "../../src/harness/contract";

describe("pi session event schema", () => {
	it("accepts the canonical valid fixture", () => {
		const result = validatePiSessionEvent(fixture);
		expect(result.valid).toBe(true);
		expect(result.errors).toHaveLength(0);
	});
});
