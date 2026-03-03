import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { hashBytes } from "@forkloom/shared";
import { SkillService, runSkillScript } from "../../apps/api/src/skill";
import { writeJson } from "./live-support";

const EXPECTED_PACKS = [
	"contract-review",
	"invoice-extract",
	"meeting-to-actions",
	"policy-qa",
] as const;

type SkillsValidateReport = {
	status: "ok" | "fail";
	generatedAt: string;
	skillsRoot: string;
	expectedPacks: string[];
	loadedPacks: string[];
	dynamicPacks: string[];
	warnings: Array<{ code: string; path: string }>;
	xmlPath: string;
	xmlBytes: number;
	packProofPath: string;
};

async function ensureSkillBodyContracts(
	skillsRoot: string,
	skillNames: readonly string[],
): Promise<void> {
	for (const name of skillNames) {
		const body = await readFile(resolve(skillsRoot, name, "SKILL.md"), "utf8");
		if (!body.includes("## Outputs (ARTIFACTS)")) {
			throw new Error(`missing outputs section: ${name}`);
		}
		if (!/\[.+\]\(scripts\/.+\.sh\)/.test(body)) {
			throw new Error(`missing script link: ${name}`);
		}
	}
}

type PackDynamicProof = {
	pack: string;
	primaryOutputPath: string;
	argA: string;
	argB: string;
	shaA: string;
	shaB: string;
};

const PACK_SCRIPT_PROOFS: ReadonlyArray<{
	pack: string;
	scriptPath: string;
	primaryOutputPath: string;
	argA: string;
	argB: string;
}> = [
	{
		pack: "policy-qa",
		scriptPath: "scripts/emit-policy-answer.sh",
		primaryOutputPath: "out/policy-qa.answer.json",
		argA: "policy delta us",
		argB: "policy delta eu",
	},
	{
		pack: "contract-review",
		scriptPath: "scripts/emit-contract-review.sh",
		primaryOutputPath: "out/contract-review.redline.md",
		argA: "msa",
		argB: "dpa",
	},
	{
		pack: "invoice-extract",
		scriptPath: "scripts/emit-invoice-extract.sh",
		primaryOutputPath: "out/invoice-reconcile.json",
		argA: "invoice acme jan",
		argB: "invoice acme feb",
	},
	{
		pack: "meeting-to-actions",
		scriptPath: "scripts/emit-meeting-actions.sh",
		primaryOutputPath: "out/meeting-actions.json",
		argA: "ops:publish release checklist,qa:verify kill-resume report",
		argB: "sec:run control audit,legal:approve msa",
	},
] as const;

function requireOutputHash(
	run: Awaited<ReturnType<typeof runSkillScript>>,
	path: string,
): string {
	const file = run.outputFiles.find((entry) => entry.path === path);
	if (!file) {
		throw new Error(`missing output file ${path} from ${run.scriptPath}`);
	}
	return hashBytes(file.body);
}

async function provePackOutputsDynamic(input: {
	skillsRoot: string;
	proofPath: string;
}): Promise<PackDynamicProof[]> {
	const sandboxRoot = await mkdtemp(
		resolve(tmpdir(), "forkloom-skill-pack-proof-"),
	);
	try {
		const testSkillsRoot = resolve(sandboxRoot, "skills");
		await cp(input.skillsRoot, testSkillsRoot, { recursive: true });
		const proofs: PackDynamicProof[] = [];
		for (const packProof of PACK_SCRIPT_PROOFS) {
			const skillPath = resolve(testSkillsRoot, packProof.pack, "SKILL.md");
			const runA = await runSkillScript({
				skillPath,
				scriptPath: packProof.scriptPath,
				args: [packProof.argA],
			});
			const runB = await runSkillScript({
				skillPath,
				scriptPath: packProof.scriptPath,
				args: [packProof.argB],
			});
			if (runA.status !== "done" || runB.status !== "done") {
				throw new Error(`pack script failed: ${packProof.pack}`);
			}
			const shaA = requireOutputHash(runA, packProof.primaryOutputPath);
			const shaB = requireOutputHash(runB, packProof.primaryOutputPath);
			if (shaA === shaB) {
				throw new Error(
					`pack output is static for ${packProof.pack} (${packProof.primaryOutputPath})`,
				);
			}
			proofs.push({
				pack: packProof.pack,
				primaryOutputPath: packProof.primaryOutputPath,
				argA: packProof.argA,
				argB: packProof.argB,
				shaA,
				shaB,
			});
		}
		await writeJson(input.proofPath, {
			status: "ok",
			generatedAt: new Date().toISOString(),
			proofs,
		});
		return proofs;
	} finally {
		await rm(sandboxRoot, { recursive: true, force: true });
	}
}

export async function runSkillsValidate(input: {
	reportPath: string;
	xmlPath: string;
	packProofPath: string;
}): Promise<SkillsValidateReport> {
	const skillsRoot = resolve("skills");
	const service = new SkillService({
		roots: [{ scope: "workspace", path: skillsRoot }],
	});
	const state = await service.getRegistryState();
	const loadedPacks = state.entries.map((entry) => entry.name);
	if (loadedPacks.join("|") !== EXPECTED_PACKS.join("|")) {
		throw new Error(
			`unexpected pack set: loaded=${loadedPacks.join(",")} expected=${EXPECTED_PACKS.join(",")}`,
		);
	}
	await ensureSkillBodyContracts(skillsRoot, EXPECTED_PACKS);
	const packProofs = await provePackOutputsDynamic({
		skillsRoot,
		proofPath: input.packProofPath,
	});

	const xml = await service.buildAvailableSkillsXml();
	await mkdir(dirname(input.xmlPath), { recursive: true });
	await writeFile(input.xmlPath, `${xml}\n`, "utf8");

	const report: SkillsValidateReport = {
		status: "ok",
		generatedAt: new Date().toISOString(),
		skillsRoot,
		expectedPacks: [...EXPECTED_PACKS],
		loadedPacks,
		dynamicPacks: packProofs.map((proof) => proof.pack),
		warnings: state.warnings.map((warning) => ({
			code: warning.code,
			path: warning.path,
		})),
		xmlPath: input.xmlPath,
		xmlBytes: Buffer.byteLength(xml, "utf8"),
		packProofPath: input.packProofPath,
	};
	await writeJson(
		input.reportPath,
		report as unknown as Record<string, unknown>,
	);
	return report;
}

async function main(): Promise<void> {
	const reportPath = process.argv[2] ?? ".cache/spec08/skills-validate.json";
	const xmlPath = process.argv[3] ?? ".cache/spec08/skills.available.xml";
	const packProofPath =
		process.argv[4] ?? ".cache/spec08/skills-pack-proof.json";
	const report = await runSkillsValidate({
		reportPath,
		xmlPath,
		packProofPath,
	});
	console.log(
		`skills-validate ${report.status}: ${report.loadedPacks.join(",")} xml=${report.xmlPath}`,
	);
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
