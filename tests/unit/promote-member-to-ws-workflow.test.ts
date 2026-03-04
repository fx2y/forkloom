import { describe, expect, it } from "vitest";
import { executePromoteMemberToWs } from "../../apps/api/src/workflow/promote-member-to-ws";

describe("promote member->ws workflow", () => {
	it("runs load/copy/provenance steps and returns pointer-sized output", async () => {
		const calls: string[] = [];
		const copied: Array<{ kind: string; key: string; sha: string | null }> = [];
		const result = await executePromoteMemberToWs(
			{
				orgId: "org-1",
				wsId: "ws-1",
				memberId: "member-1",
				kind: "policy",
				key: "policy/default",
			},
			{
				databaseUrl: "postgresql://example.invalid/unused",
				repo: {
					loadSource: async () => ({ body_artifact_sha: "a".repeat(64) }),
					copyRef: async (input, source) => {
						copied.push({
							kind: input.kind,
							key: input.key,
							sha: source.body_artifact_sha,
						});
						return source.body_artifact_sha;
					},
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
		expect(copied).toEqual([
			{ kind: "policy", key: "policy/default", sha: "a".repeat(64) },
		]);
		expect(result).toEqual({ sha: "a".repeat(64) });
	});

	it("fails when member source row is missing", async () => {
		await expect(
			executePromoteMemberToWs(
				{
					orgId: "org-1",
					wsId: "ws-1",
					memberId: "member-1",
					kind: "policy",
					key: "policy/default",
				},
				{
					databaseUrl: "postgresql://example.invalid/unused",
					repo: {
						loadSource: async () => {
							throw new Error("member-scope source row not found");
						},
						copyRef: async () => null,
						copyProvenance: async () => undefined,
					},
				},
				{
					runStep: async (_name, fn) => fn(),
				},
			),
		).rejects.toThrow("member-scope source row not found");
	});
});
