import { describe, expect, it } from "vitest";
import {
	canonicalParseStatus,
	canTransitionParseStatus,
	isOcrDoneStatus,
	transitionParseStatus,
} from "../../apps/api/src/doc";

describe("doc parse status machine", () => {
	it("canonicalizes legacy indexing status", () => {
		expect(canonicalParseStatus("indexing")).toBe("indexed");
		expect(canonicalParseStatus("ocr_done")).toBe("ocr_done");
	});

	it("accepts only valid transitions", () => {
		expect(canTransitionParseStatus("queued", "ocr_running")).toBe(true);
		expect(canTransitionParseStatus("ocr_running", "queued")).toBe(false);
		expect(canTransitionParseStatus("ocr_done", "norm_done")).toBe(true);
		expect(canTransitionParseStatus("indexed", "done")).toBe(true);
	});

	it("fails fast on invalid status transitions", () => {
		expect(() => transitionParseStatus("done", "queued")).toThrow(
			"invalid parse status transition",
		);
	});

	it("marks OCR-done family statuses as cacheable", () => {
		expect(isOcrDoneStatus("ocr_done")).toBe(true);
		expect(isOcrDoneStatus("norm_done")).toBe(true);
		expect(isOcrDoneStatus("indexing")).toBe(true);
		expect(isOcrDoneStatus("done")).toBe(true);
		expect(isOcrDoneStatus("queued")).toBe(false);
	});
});

