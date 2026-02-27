import { describe, expect, it } from "vitest";
import { hashText } from "../../src/harness/artifact";

describe("artifact hashing", () => {
	it("produces stable sha256 digests", () => {
		expect(hashText("abc")).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
		);
	});
});
