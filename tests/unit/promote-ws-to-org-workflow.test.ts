import { describe, expect, it } from "vitest";
import { executePromoteWsToOrg } from "../../apps/api/src/workflow/promote-ws-to-org";

describe("promote ws->org workflow", () => {
	it("runs load/copy/provenance steps and returns pointer-sized output", async () => {
		const calls: string[] = [];
		const result = await executePromoteWsToOrg(
			{
				orgId: "org-1",
				wsId: "ws-1",
				kind: "policy",
				key: "policy/default",
			},
			{
				databaseUrl: "postgresql://example.invalid/unused",
				repo: {
					loadSource: async () => ({ body_artifact_sha: "b".repeat(64) }),
					copyRef: async (_input, source) => source.body_artifact_sha,
					copyProvenance: async () => undefined,
				},
			},
			{
				runStep: async (name, fn) => {
					calls.push(name);
					return fn();
				},
			},
		);

		expect(calls).toEqual(["loadSource", "copyRef", "copyProvenance"]);
		expect(result).toEqual({ sha: "b".repeat(64) });
	});

	it("fails when workspace source row is missing", async () => {
		await expect(
			executePromoteWsToOrg(
				{
					orgId: "org-1",
					wsId: "ws-1",
					kind: "policy",
					key: "policy/default",
				},
				{
					databaseUrl: "postgresql://example.invalid/unused",
					repo: {
						loadSource: async () => {
							throw new Error("workspace-scope source row not found");
						},
						copyRef: async () => null,
						copyProvenance: async () => undefined,
					},
				},
				{
					runStep: async (_name, fn) => fn(),
				},
			),
		).rejects.toThrow("workspace-scope source row not found");
	});
});
