import { describe, expect, it } from "vitest";
import { canonicalizeJsonl } from "../../src/harness/canonicalize";

describe("canonicalizeJsonl", () => {
	it("strips volatile fields and sorts object keys", () => {
		const input =
			'{"id":"1","timestamp":"2026-02-27T00:00:00Z","message":{"content":"hi","role":"user","timestamp":"x"},"type":"prompt"}\n';

		const output = canonicalizeJsonl(input);
		expect(output).toBe(
			'{"id":"1","message":{"content":"hi","role":"user"},"type":"prompt"}\n',
		);
	});
});
