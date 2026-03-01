import { hashJSON, stableStringify } from "@forkloom/shared";
import { describe, expect, it } from "vitest";

describe("stableStringify", () => {
	it("sorts object keys deterministically", () => {
		const first = stableStringify({ b: 2, a: { y: 1, x: 0 } });
		const second = stableStringify({ a: { x: 0, y: 1 }, b: 2 });
		expect(first).toBe('{"a":{"x":0,"y":1},"b":2}');
		expect(second).toBe(first);
	});

	it("rejects non-serializable top-level values", () => {
		expect(() => stableStringify(undefined)).toThrow(
			"stable stringify input must be JSON-serializable",
		);
	});
});

describe("hashJSON", () => {
	it("is stable across equivalent JSON payloads", () => {
		const first = hashJSON({
			runId: "r1",
			payload: { z: 1, a: [1, 2, 3] },
		});
		const second = hashJSON({
			payload: { a: [1, 2, 3], z: 1 },
			runId: "r1",
		});
		expect(second).toBe(first);
	});
});
