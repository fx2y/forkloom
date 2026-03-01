import { describe, expect, it } from "vitest";
import {
	getAllContractNames,
	getRunContractNames,
	validateAnyByName,
} from "../../packages/contracts/src/validate";

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";

describe("contracts validate namespace", () => {
	it("exposes both v0 and v1 contract names", () => {
		const all = getAllContractNames();
		expect(all).toContain("Message");
		expect(all).toContain("RunSpec");
		expect(getRunContractNames()).toEqual([
			"RunSpec",
			"RunState",
			"RunEvent",
			"TruthBundle",
			"SpanRef",
			"RunDocSearch",
			"RunDocResolve",
		]);
	});

	it("validates run payloads through unified validator", () => {
		const good = validateAnyByName("RunEvent", {
			runId: RUN_ID,
			seq: 1,
			t: "2026-02-27T00:00:00Z",
			kind: "run_previewed",
			payload: {
				preview: {
					imageDigest: "node:24-alpine",
					profile: "safe",
					network: "off",
					workdir: "/work",
					timeoutSec: 900,
					maxBytesOut: 1024,
					mounts: [{ dest: "/work", mode: "rw", kind: "work" }],
				},
			},
		});
		const bad = validateAnyByName("RunEvent", {
			runId: RUN_ID,
			seq: 0,
			t: "bad-time",
			kind: "bad_kind",
			payload: [],
		});

		expect(good.valid).toBe(true);
		expect(good.errors).toHaveLength(0);
		expect(bad.valid).toBe(false);
		expect(bad.errors.join("; ")).toContain("/seq");
	});

	it("validates run-owned doc contracts through the run namespace", () => {
		const search = validateAnyByName("RunDocSearch", {
			query: "footnote",
			scope: "parse:abc",
			hits: [
				{
					chunkId: "chunk:abc",
					score: 0.7,
					spans: [
						{
							docSha: "a".repeat(64),
							parseId: "parse:abc",
							page: 1,
							bbox: [1, 2, 3, 4],
							charStart: null,
							charEnd: null,
							blockPath: "0.1",
							chunkId: "chunk:abc",
						},
					],
					snippet: "footnote text",
				},
			],
		});
		const resolve = validateAnyByName("RunDocResolve", {
			span: {
				docSha: "a".repeat(64),
				parseId: "parse:abc",
				page: 1,
				bbox: [1, 2, 3, 4],
				charStart: null,
				charEnd: null,
				blockPath: "0.1",
				chunkId: "chunk:abc",
			},
			md: "footnote text",
			bbox: [1, 2, 3, 4],
			pageImageSha: "b".repeat(64),
		});

		expect(search.valid).toBe(true);
		expect(resolve.valid).toBe(true);
	});
});
