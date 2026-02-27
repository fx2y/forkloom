import { describe, expect, it } from "vitest";
import { normalizeOcrResult } from "../../src/harness/ocr";

describe("normalizeOcrResult", () => {
	it("canonicalizes markdown/json/spans and emits stable hash", () => {
		const first = normalizeOcrResult({
			markdown: "# A  \n\nB\n",
			json: { z: 1, timestamp: "x", a: 2 },
			spans: [
				{ text: "B", start: 3, end: 4, page: 1 },
				{ text: " A ", start: 0, end: 1, page: 1 },
			],
		});

		const second = normalizeOcrResult({
			markdown: "# A\n\nB",
			json: { a: 2, z: 1, timestamp: "y" },
			spans: [
				{ text: "A", start: 0, end: 1, page: 1 },
				{ text: "B", start: 3, end: 4, page: 1 },
			],
		});

		expect(first.sha256).toBe(second.sha256);
		expect(first.markdown).toBe("# A\n\nB");
	});
});
