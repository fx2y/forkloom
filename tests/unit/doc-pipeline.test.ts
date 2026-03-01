import { describe, expect, it } from "vitest";
import { buildDocPipeline } from "../../apps/api/src/doc";

function sampleLayout() {
	return [
		[
			{
				index: 0,
				label: "H1",
				bbox2d: [0.1, 0.1, 0.9, 0.16] as [number, number, number, number],
				content: "Quarterly Results",
				width: 1000,
				height: 1400,
			},
			{
				index: 1,
				label: "P",
				bbox2d: [0.1, 0.2, 0.9, 0.3] as [number, number, number, number],
				content: "Revenue increased 22 percent year over year.",
				width: 1000,
				height: 1400,
			},
			{
				index: 2,
				label: "TABLE",
				bbox2d: [0.1, 0.32, 0.9, 0.62] as [number, number, number, number],
				content: "|Q1|Q2|\n|---|---|\n|12|14|",
				width: 1000,
				height: 1400,
			},
		],
	];
}

describe("doc pipeline", () => {
	it("is deterministic for equivalent layout input", () => {
		const input = {
			docSha: "a".repeat(64),
			parseId: "b".repeat(64),
			layoutDetails: sampleLayout(),
		};
		const first = buildDocPipeline(input);
		const second = buildDocPipeline(input);

		expect(second).toEqual(first);
		expect(first.blocks.length).toBeGreaterThan(0);
		expect(first.chunks.length).toBeGreaterThan(0);
		expect(first.spans.length).toBeGreaterThan(0);
		expect(first.search.every((entry) => (entry.embedding?.length ?? 0) > 0)).toBe(
			true,
		);
	});

	it("keeps table blocks atomic and wires neighbor edges", () => {
		const output = buildDocPipeline({
			docSha: "c".repeat(64),
			parseId: "d".repeat(64),
			layoutDetails: sampleLayout(),
		});
		const tableChunk = output.chunks.find((chunk) => chunk.kind === "table");
		expect(tableChunk).toBeDefined();
		expect(output.chunks[0]?.prevChunkId).toBeNull();
		expect(output.chunks.at(-1)?.nextChunkId).toBeNull();
	});
});

