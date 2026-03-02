import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { SkillService } from "../../apps/api/src/skill";
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
	warnings: Array<{ code: string; path: string }>;
	xmlPath: string;
	xmlBytes: number;
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

export async function runSkillsValidate(input: {
	reportPath: string;
	xmlPath: string;
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

	const xml = await service.buildAvailableSkillsXml();
	await mkdir(dirname(input.xmlPath), { recursive: true });
	await writeFile(input.xmlPath, `${xml}\n`, "utf8");

	const report: SkillsValidateReport = {
		status: "ok",
		generatedAt: new Date().toISOString(),
		skillsRoot,
		expectedPacks: [...EXPECTED_PACKS],
		loadedPacks,
		warnings: state.warnings.map((warning) => ({
			code: warning.code,
			path: warning.path,
		})),
		xmlPath: input.xmlPath,
		xmlBytes: Buffer.byteLength(xml, "utf8"),
	};
	await writeJson(input.reportPath, report as unknown as Record<string, unknown>);
	return report;
}

async function main(): Promise<void> {
	const reportPath = process.argv[2] ?? ".cache/spec08/skills-validate.json";
	const xmlPath = process.argv[3] ?? ".cache/spec08/skills.available.xml";
	const report = await runSkillsValidate({ reportPath, xmlPath });
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
