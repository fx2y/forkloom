import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type DocLiveE2EProof = {
	status: "ok" | "fail";
	first: { status: string; parseId: string };
	second: { status: string; parseId: string };
	snapshot: {
		status: string;
		usageCount: number;
		chunkCount: number;
		spanCount: number;
		duplicateChunkIds: number;
	};
	checks: Record<string, boolean>;
};

describe("doc live e2e proof", () => {
	it("asserts IngestDocV1->DocOcrV1 executes live with dedupe and single billing", () => {
		const proofPath = ".cache/spec07/cy6-live-e2e.json";
		if (!existsSync(proofPath)) {
			throw new Error(
				"missing .cache/spec07/cy6-live-e2e.json; run `MISE_EXPERIMENTAL=1 mise run test:int:doc-ocr` first",
			);
		}
		const parsed = JSON.parse(
			readFileSync(proofPath, "utf8"),
		) as Partial<DocLiveE2EProof>;
		expect(parsed.status).toBe("ok");
		expect(parsed.first?.status).toBe("queued");
		expect(parsed.second?.status).toBe("deduped");
		expect(parsed.first?.parseId).toBe(parsed.second?.parseId);
		expect(parsed.snapshot?.status).toBe("done");
		expect(parsed.snapshot?.usageCount).toBe(1);
		expect(parsed.snapshot?.chunkCount).toBeGreaterThan(0);
		expect(parsed.snapshot?.spanCount).toBeGreaterThan(0);
		expect(parsed.snapshot?.duplicateChunkIds).toBe(0);
		expect(
			Object.values(parsed.checks ?? {}).every((flag) => flag === true),
		).toBe(true);
	});
});
