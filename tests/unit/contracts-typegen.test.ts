import { describe, expect, it } from "vitest";
import { renderTypes } from "../../packages/contracts/src/typegen";

describe("contracts typegen", () => {
	it("renders v1 run types from schemas", () => {
		const out = renderTypes();
		expect(out).toContain("export type RunEventKind =");
		expect(out).toContain('\t| "run_started"');
		expect(out).toContain("export type RunSpec = {");
		expect(out).toContain("export type RunState = {");
		expect(out).toContain("export type RunDonePayload = {");
		expect(out).toContain("export type RunEvent =");
	});
});
