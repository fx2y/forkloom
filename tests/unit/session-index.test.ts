import { describe, expect, it } from "vitest";
import {
	assertToolCallResultAdjacency,
	parseSessionJsonl,
} from "../../apps/api/src/pi/session-index";

describe("parseSessionJsonl", () => {
	it("builds root/leaf pointers and leaf path", () => {
		const parsed = parseSessionJsonl(
			[
				'{"type":"session","id":"root"}',
				'{"type":"prompt","id":"p1","parentId":"root"}',
				'{"type":"tool_call","id":"t1","parentId":"p1"}',
				'{"type":"tool_result","id":"r1","parentId":"t1"}',
				'{"type":"assistant","id":"a1","parentId":"r1"}',
			].join("\n"),
		);

		expect(parsed.entryCount).toBe(5);
		expect(parsed.rootId).toBe("root");
		expect(parsed.leafId).toBe("a1");
		expect(parsed.leafPathIds).toEqual(["root", "p1", "t1", "r1", "a1"]);
	});

	it("flags compaction and branch summary entries", () => {
		const parsed = parseSessionJsonl(
			[
				'{"type":"session","id":"root"}',
				'{"type":"compaction","id":"c1","parentId":"root"}',
				'{"type":"branch_summary","id":"b1","parentId":"root"}',
			].join("\n"),
		);

		expect(parsed.summaryEntryCount).toBe(2);
		expect(parsed.compactionEntryCount).toBe(1);
		expect(parsed.branchSummaryEntryCount).toBe(1);
	});

	it("rejects dangling parent links", () => {
		expect(() =>
			parseSessionJsonl(
				[
					'{"type":"session","id":"root"}',
					'{"type":"assistant","id":"a1","parentId":"missing"}',
				].join("\n"),
			),
		).toThrow("dangling parent");
	});
});

describe("assertToolCallResultAdjacency", () => {
	it("allows summary entries between tool_call and tool_result", () => {
		const parsed = parseSessionJsonl(
			[
				'{"type":"session","id":"root"}',
				'{"type":"tool_call","id":"call-1","parentId":"root"}',
				'{"type":"compaction","id":"sum-1","parentId":"root"}',
				'{"type":"tool_result","id":"res-1","parentId":"call-1"}',
			].join("\n"),
		);

		expect(() => assertToolCallResultAdjacency(parsed.entries)).not.toThrow();
	});

	it("fails when tool_call is not followed by tool_result", () => {
		const parsed = parseSessionJsonl(
			[
				'{"type":"session","id":"root"}',
				'{"type":"tool_call","id":"call-1","parentId":"root"}',
				'{"type":"assistant","id":"msg-1","parentId":"call-1"}',
			].join("\n"),
		);

		expect(() => assertToolCallResultAdjacency(parsed.entries)).toThrow(
			"adjacency broken",
		);
	});
});
