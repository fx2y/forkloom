import { describe, expect, it, vi } from "vitest";
import { HttpError } from "../../apps/api/src/errors";
import { asyncHandler, mapError } from "../../apps/api/src/http/route-utils";

describe("route-utils", () => {
	it("maps HttpError to declared status and message", () => {
		expect(mapError(new HttpError(409, "immutable artifact"))).toEqual({
			status: 409,
			message: "immutable artifact",
		});
	});

	it("maps SyntaxError to 400", () => {
		const mapped = mapError(new SyntaxError("bad json"));
		expect(mapped.status).toBe(400);
		expect(mapped.message).toContain("bad json");
	});

	it("maps unknown errors to 500", () => {
		expect(mapError(new Error("boom"))).toEqual({
			status: 500,
			message: "internal error",
		});
	});

	it("forwards async failures to next()", async () => {
		const next = vi.fn();
		const wrapped = asyncHandler(async () => {
			throw new Error("kaboom");
		});
		wrapped({} as never, {} as never, next);
		await Promise.resolve();
		expect(next).toHaveBeenCalledTimes(1);
	});
});
