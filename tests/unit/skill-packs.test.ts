import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillService, runSkillScript } from "../../apps/api/src/skill";

const PACKS = [
	"policy-qa",
	"contract-review",
	"invoice-extract",
	"meeting-to-actions",
] as const;

const REPO_SKILLS_ROOT = resolve(process.cwd(), "skills");

function pickOutput(
	outputs: Array<{ path: string; body: Buffer }>,
	path: string,
): Buffer {
	const file = outputs.find((entry) => entry.path === path);
	if (!file) {
		throw new Error(`missing output file: ${path}`);
	}
	return file.body;
}

describe("spec08 skill packs", () => {
	it("ships minimal first-party pack footprints with explicit artifact sections", async () => {
		for (const pack of PACKS) {
			const skillPath = join(REPO_SKILLS_ROOT, pack, "SKILL.md");
			const content = await readFile(skillPath, "utf8");
			expect(content).toContain(`name: ${pack}`);
			expect(content).toContain("## Outputs (ARTIFACTS)");
			expect(content).toMatch(/\[.+\]\(scripts\/.+\.sh\)/);
			expect(content.length).toBeLessThan(4_500);
		}
	});

	it("registers all first-party packs through SkillService and exposes truthful preview", async () => {
		const service = new SkillService({
			roots: [{ scope: "workspace", path: REPO_SKILLS_ROOT }],
		});
		const names = (await service.listSkills()).map((entry) => entry.name);
		expect(names).toEqual([...PACKS].sort((left, right) => left.localeCompare(right)));
		for (const pack of PACKS) {
			const preview = await service.previewSkill({ skillName: pack });
			expect(preview).not.toBeNull();
			expect(preview?.scripts).toHaveLength(1);
			expect(preview?.scripts[0]).toMatch(/^scripts\/.+\.sh$/);
			expect(preview?.touchedPaths).toContain(preview?.scripts[0] ?? "");
		}
	});

	it("executes pack scripts via existing runtime and emits typed artifacts", async () => {
		const sandbox = await mkdtemp(join(tmpdir(), "skill-packs-"));
		try {
			await cp(REPO_SKILLS_ROOT, join(sandbox, "skills"), { recursive: true });

			const policyRun = await runSkillScript({
				skillPath: join(sandbox, "skills", "policy-qa", "SKILL.md"),
				scriptPath: "scripts/emit-policy-answer.sh",
				args: ["control", "delta"],
			});
			expect(policyRun.status).toBe("done");
			expect(policyRun.outputFiles.map((file) => file.path)).toEqual([
				"out/policy-qa.answer.json",
				"out/policy-qa.citations.json",
			]);
			expect(
				JSON.parse(
					pickOutput(policyRun.outputFiles, "out/policy-qa.answer.json").toString(
						"utf8",
					),
				) as { kind?: string },
			).toMatchObject({ kind: "policy_qa_answer_v1" });

			const contractRun = await runSkillScript({
				skillPath: join(sandbox, "skills", "contract-review", "SKILL.md"),
				scriptPath: "scripts/emit-contract-review.sh",
				args: ["msa"],
			});
			expect(contractRun.status).toBe("done");
			expect(contractRun.outputFiles.map((file) => file.path)).toEqual([
				"out/contract-review.checklist.json",
				"out/contract-review.redline.md",
				"out/contract-review.risks.csv",
			]);
			expect(
				JSON.parse(
					pickOutput(
						contractRun.outputFiles,
						"out/contract-review.checklist.json",
					).toString("utf8"),
				) as { kind?: string },
			).toMatchObject({ kind: "contract_review_checklist_v1" });

			const invoiceRun = await runSkillScript({
				skillPath: join(sandbox, "skills", "invoice-extract", "SKILL.md"),
				scriptPath: "scripts/emit-invoice-extract.sh",
				args: ["invoice-1"],
			});
			expect(invoiceRun.status).toBe("done");
			expect(invoiceRun.outputFiles.map((file) => file.path)).toEqual([
				"out/invoice-lines.csv",
				"out/invoice-reconcile.json",
			]);
			expect(
				JSON.parse(
					pickOutput(invoiceRun.outputFiles, "out/invoice-reconcile.json").toString(
						"utf8",
					),
				) as { kind?: string },
			).toMatchObject({ kind: "invoice_reconcile_v1" });

			const actionsRun = await runSkillScript({
				skillPath: join(sandbox, "skills", "meeting-to-actions", "SKILL.md"),
				scriptPath: "scripts/emit-meeting-actions.sh",
				args: ["weekly"],
			});
			expect(actionsRun.status).toBe("done");
			expect(actionsRun.outputFiles.map((file) => file.path)).toEqual([
				"out/follow-through.stub.json",
				"out/meeting-actions.json",
			]);
			expect(
				JSON.parse(
					pickOutput(actionsRun.outputFiles, "out/meeting-actions.json").toString(
						"utf8",
					),
				) as { kind?: string },
			).toMatchObject({ kind: "meeting_actions_v1" });
			expect(
				JSON.parse(
					pickOutput(
						actionsRun.outputFiles,
						"out/follow-through.stub.json",
					).toString("utf8"),
				) as { launcher?: string; note?: string },
			).toMatchObject({
				launcher: "enqueueActorTick",
				note: expect.stringContaining("mailbox commands are forbidden"),
			});
		} finally {
			await rm(sandbox, { recursive: true, force: true });
		}
	});
});
