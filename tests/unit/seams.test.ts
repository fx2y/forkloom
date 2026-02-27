import { describe, expect, it } from "vitest";
import { API_SEAMS } from "../../apps/api/src/seams";

describe("api seam ownership map", () => {
	it("declares run/pi/workflow/http roots", () => {
		expect(API_SEAMS.run.root).toBe("apps/api/src/run");
		expect(API_SEAMS.pi.root).toBe("apps/api/src/pi");
		expect(API_SEAMS.workflow.root).toBe("apps/api/src/workflow");
		expect(API_SEAMS.http.root).toBe("apps/api/src/http");
	});

	it("keeps http seam free of infra adapters", () => {
		expect(API_SEAMS.http.canImportFrom).toEqual(["apps/api/src/service"]);
	});
});
