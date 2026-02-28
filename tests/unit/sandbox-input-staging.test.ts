import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { materializeSandboxInputs } from "../../apps/api/src/sandbox/input-staging";

describe("materializeSandboxInputs", () => {
	it("writes attachment artifacts into a run-scoped inputs dir", async () => {
		const root = await mkdtemp(join(tmpdir(), "forkloom-stage-"));
		try {
			const staged = await materializeSandboxInputs({
				runId: "run-1",
				attachments: [{ sha256: "a".repeat(64) }, { sha256: "b".repeat(64) }],
				inputRoot: root,
				artifactService: {
					getArtifactBytes: async (sha256) => ({
						body: Readable.from([Buffer.from(`payload:${sha256}`)]),
						contentType: "application/octet-stream",
					}),
				},
			});

			expect(staged.staged).toHaveLength(2);
			expect(staged.staged[0]?.mountPath).toBe(
				`/inputs/01-${"a".repeat(64)}.bin`,
			);
			expect(await readFile(staged.staged[1]?.hostPath ?? "", "utf8")).toBe(
				`payload:${"b".repeat(64)}`,
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
