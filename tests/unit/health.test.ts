import { describe, expect, it, vi } from "vitest";
import { buildHealthHandler } from "../../apps/api/src/http/health";

type StubResponse = {
	statusCode: number;
	body: unknown;
	status(code: number): StubResponse;
	json(payload: unknown): void;
};

function createResponse(): StubResponse {
	return {
		statusCode: 200,
		body: null,
		status(code: number) {
			this.statusCode = code;
			return this;
		},
		json(payload: unknown) {
			this.body = payload;
		},
	};
}

describe("buildHealthHandler", () => {
	it("returns 503 when pi readiness probe fails", async () => {
		const pingPi = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
		const handler = buildHealthHandler({
			repo: { ping: async () => true } as never,
			store: { ping: async () => true } as never,
			pingPi,
		});
		const res = createResponse();

		await handler({} as never, res as never);

		expect(pingPi).toHaveBeenCalledTimes(1);
		expect(res.statusCode).toBe(503);
		expect(res.body).toEqual({
			ok: false,
			deps: {
				pg: true,
				s3: true,
				pi: false,
				api: true,
			},
		});
	});
});
