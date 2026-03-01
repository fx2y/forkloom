import { describe, expect, it } from "vitest";
import {
	API_OWNERSHIP_LAW,
	API_REUSE_CUTS,
	API_SEAMS,
} from "../../apps/api/src/seams";

describe("api seam ownership map", () => {
	it("declares actor/doc/run/sandbox/pi/workflow/http roots", () => {
		expect(API_SEAMS.actor.root).toBe("apps/api/src/actor");
		expect(API_SEAMS.doc.root).toBe("apps/api/src/doc");
		expect(API_SEAMS.run.root).toBe("apps/api/src/run");
		expect(API_SEAMS.sandbox.root).toBe("apps/api/src/sandbox");
		expect(API_SEAMS.pi.root).toBe("apps/api/src/pi");
		expect(API_SEAMS.workflow.root).toBe("apps/api/src/workflow");
		expect(API_SEAMS.http.root).toBe("apps/api/src/http");
	});

	it("keeps http seam free of infra adapters", () => {
		expect(API_SEAMS.http.canImportFrom).toEqual(["apps/api/src/service"]);
	});

	it("pins concrete reuse cuts before sandbox runtime work", () => {
		expect(API_REUSE_CUTS.sseBuffer.root).toBe(
			"apps/api/src/http/sse-buffer.ts",
		);
		expect(API_REUSE_CUTS.eventReplayCursor.root).toBe(
			"apps/api/src/http/event-stream.ts",
		);
		expect(API_REUSE_CUTS.piRpcClient.root).toBe(
			"apps/api/src/pi/rpc-client.ts",
		);
		expect(API_REUSE_CUTS.actorLiveHarness.status).toBe(
			"defer-until-second-caller",
		);
	});

	it("freezes run vs sandbox ownership before backend work lands", () => {
		expect(API_OWNERSHIP_LAW.run).toContain("run owns");
		expect(API_OWNERSHIP_LAW.doc).toContain("/runs");
		expect(API_OWNERSHIP_LAW.sandbox).toContain("sandbox owns");
		expect(API_OWNERSHIP_LAW.actorReuseOnly).toContain("reuse");
	});
});
