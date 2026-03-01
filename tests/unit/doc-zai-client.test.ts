import { describe, expect, it } from "vitest";
import { ZaiLayoutClient } from "../../apps/api/src/doc";

describe("ZaiLayoutClient", () => {
	it("decodes layout_parsing payload with strict fields", async () => {
		const client = new ZaiLayoutClient({
			endpoint: "https://api.z.ai/api/paas/v4/layout_parsing",
			apiKey: "secret",
			model: "glm-ocr",
			fetchImpl: async (_url, _init) =>
				new Response(
					JSON.stringify({
						md_results: "# Title",
						layout_details: [
							[
								{
									index: 0,
									label: "P",
									bbox_2d: [0, 0, 1, 1],
									content: "Title",
									width: 1000,
									height: 1200,
								},
							],
						],
						data_info: { num_pages: 1 },
						usage: { input_pages: 1, output_tokens: 23, cost_micros: 45 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		});

		const result = await client.layoutParsing("s3://bucket/cas/aa/bb");
		expect(result.markdown).toBe("# Title");
		expect(result.pageCount).toBe(1);
		expect(result.layoutDetails).toHaveLength(1);
		expect(result.usage.outputTokens).toBe(23);
		expect(result.usage.costMicros).toBe(45);
	});

	it("retries transient failures before succeeding", async () => {
		let calls = 0;
		const client = new ZaiLayoutClient({
			endpoint: "https://api.z.ai/api/paas/v4/layout_parsing",
			apiKey: "secret",
			model: "glm-ocr",
			retryLimit: 3,
			retryDelayMs: 1,
			fetchImpl: async () => {
				calls += 1;
				if (calls === 1) {
					return new Response("busy", { status: 503 });
				}
				return new Response(
					JSON.stringify({
						md_results: "ok",
						layout_details: [[]],
						data_info: { num_pages: 1 },
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		});

		const result = await client.layoutParsing("s3://bucket/cas/aa/bb");
		expect(calls).toBe(2);
		expect(result.markdown).toBe("ok");
	});

	it("fails on non-decodable payloads", async () => {
		const client = new ZaiLayoutClient({
			endpoint: "https://api.z.ai/api/paas/v4/layout_parsing",
			apiKey: "secret",
			model: "glm-ocr",
			retryLimit: 1,
			fetchImpl: async () =>
				new Response(
					JSON.stringify({
						md_results: 1,
						layout_details: "bad",
					}),
					{ status: 200, headers: { "content-type": "application/json" } },
				),
		});

		await expect(
			client.layoutParsing("s3://bucket/cas/aa/bb"),
		).rejects.toThrow("layout_parsing failed");
	});
});

