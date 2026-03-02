import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	executeSkillPlanDurably,
	readSkillFileRequest,
	resolveSkillPath,
	runSkillScript,
} from "../../apps/api/src/skill";

function hashBytes(body: Buffer): string {
	return createHash("sha256").update(body).digest("hex");
}

describe("skill L3 runtime", () => {
	it("jails skill file resolution and reads only references/assets lazily", async () => {
		const root = await mkdtemp(join(tmpdir(), "skill-lazy-"));
		try {
			const skillDir = join(root, "policy-qa");
			const skillPath = join(skillDir, "SKILL.md");
			await mkdir(join(skillDir, "references"), { recursive: true });
			await mkdir(join(skillDir, "assets"), { recursive: true });
			await writeFile(
				skillPath,
				"---\nname: policy-qa\ndescription: policy\n---\n",
			);
			await writeFile(join(skillDir, "references", "guide.md"), "guide");
			await writeFile(join(skillDir, "assets", "logo.txt"), "logo");

			const refResult = await readSkillFileRequest({
				skillPath,
				request: {
					type: "read-skill-file",
					relPath: "references/guide.md",
				},
			});
			expect(refResult.path).toBe("references/guide.md");
			expect(refResult.body.toString("utf8")).toBe("guide");

			const assetResult = await readSkillFileRequest({
				skillPath,
				request: {
					type: "read-skill-file",
					relPath: "assets/logo.txt",
				},
			});
			expect(assetResult.path).toBe("assets/logo.txt");
			expect(assetResult.body.toString("utf8")).toBe("logo");

			expect(() => resolveSkillPath(skillDir, "../../etc/passwd")).toThrow(
				"skill path escape",
			);
			await expect(
				readSkillFileRequest({
					skillPath,
					request: {
						type: "read-skill-file",
						relPath: "scripts/run.sh",
					},
				}),
			).rejects.toThrow("references/* or assets/*");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("runs scripts via bash from skill dir and captures deterministic outputs", async () => {
		const root = await mkdtemp(join(tmpdir(), "skill-runner-"));
		try {
			const skillDir = join(root, "policy-qa");
			const skillPath = join(skillDir, "SKILL.md");
			await mkdir(join(skillDir, "scripts"), { recursive: true });
			await writeFile(
				skillPath,
				"---\nname: policy-qa\ndescription: policy\n---\n",
			);
			await writeFile(
				join(skillDir, "scripts", "run.sh"),
				[
					"#!/usr/bin/env bash",
					"set -euo pipefail",
					"mkdir -p out",
					'echo "stdout:$1"',
					'echo "stderr:$2" 1>&2',
					'echo "$1|$2" > out/result.txt',
				].join("\n"),
				"utf8",
			);

			const run = await runSkillScript({
				skillPath,
				scriptPath: "scripts/run.sh",
				args: ["alpha", "beta"],
			});
			expect(run.status).toBe("done");
			expect(run.exitCode).toBe(0);
			expect(run.stdout).toContain("stdout:alpha");
			expect(run.stderr).toContain("stderr:beta");
			expect(run.outputFiles.map((file) => file.path)).toEqual([
				"out/result.txt",
			]);
			expect(run.outputFiles[0]?.body.toString("utf8").trim()).toBe(
				"alpha|beta",
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("persists script stdout/stderr/files through existing artifact+ledger seams", async () => {
		const root = await mkdtemp(join(tmpdir(), "skill-durable-"));
		try {
			const skillDir = join(root, "policy-qa");
			const skillPath = join(skillDir, "SKILL.md");
			await mkdir(join(skillDir, "scripts"), { recursive: true });
			await writeFile(
				skillPath,
				"---\nname: policy-qa\ndescription: policy\n---\n",
			);
			await writeFile(
				join(skillDir, "scripts", "run.sh"),
				[
					"#!/usr/bin/env bash",
					"set -euo pipefail",
					"mkdir -p out",
					'echo "stdout:$1"',
					'echo "stderr:$2" 1>&2',
					'echo "$1|$2" > out/result.txt',
				].join("\n"),
				"utf8",
			);

			const ledgerWrites: Array<{
				stepName: string;
				attempt: number;
				artifactShas: string[];
				payload?: Record<string, unknown>;
			}> = [];
			const linked: string[] = [];
			const written: string[] = [];

			const rows = await executeSkillPlanDurably({
				runId: "01HS7Z6E5R4W6NED8MH4D9Y6A0",
				commandSeq: 7,
				commandKind: "prompt",
				plan: {
					skillName: "policy-qa",
					skillPath,
					argsText: "alpha beta",
					scripts: ["scripts/run.sh"],
				},
				deps: {
					artifactService: {
						putArtifact: async ({ body }) => ({
							sha256: hashBytes(body),
						}),
					},
					runService: {
						linkArtifact: async (_runId, sha) => {
							linked.push(sha);
						},
						appendArtifactWritten: async (_runId, input) => {
							written.push(input.sha256);
						},
						recordStepLedger: async (input) => {
							ledgerWrites.push({
								stepName: input.stepName,
								attempt: input.attempt,
								artifactShas: input.artifactShas,
								payload: input.payload,
							});
						},
					},
				},
			});

			expect(rows).toHaveLength(1);
			expect(rows[0]?.status).toBe("done");
			expect(rows[0]?.attempt).toBe(7001);
			expect(rows[0]?.stepName).toBe("skill_exec");
			expect(linked.length).toBeGreaterThanOrEqual(3);
			expect(written.length).toBeGreaterThanOrEqual(3);
			expect(ledgerWrites).toHaveLength(1);
			expect(ledgerWrites[0]?.stepName).toBe("skill_exec");
			expect(ledgerWrites[0]?.attempt).toBe(7001);
			expect(ledgerWrites[0]?.artifactShas).toHaveLength(3);
			expect(ledgerWrites[0]?.payload).toBeTruthy();
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
