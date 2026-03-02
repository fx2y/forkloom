import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { SkillService } from "../../apps/api/src/skill";
import { writeJson } from "./live-support";

type SkillPerfReport = {
	status: "ok" | "fail";
	generatedAt: string;
	skillCount: number;
	coldMs: number;
	warmMs: number;
	coldBudgetMs: number;
	warmBudgetMs: number;
	prefixReads: number;
	fullReads: number;
};

const DEFAULT_SKILL_COUNT = 1_000;

function nowMs(): number {
	return Number(process.hrtime.bigint() / 1_000_000n);
}

async function writeSyntheticSkills(root: string, count: number): Promise<void> {
	for (let i = 0; i < count; i += 1) {
		const name = `skill-${String(i).padStart(4, "0")}`;
		const dir = join(root, name);
		await mkdir(join(dir, "scripts"), { recursive: true });
		await writeFile(
			join(dir, "SKILL.md"),
			[
				"---",
				`name: ${name}`,
				`description: synthetic ${name} for cold/warm registry scan`,
				"---",
				"# synthetic",
				"Run [script](scripts/run.sh) with $ARGUMENTS.",
			].join("\n") + "\n",
			"utf8",
		);
		await writeFile(join(dir, "scripts", "run.sh"), "#!/usr/bin/env bash\n", "utf8");
	}
}

export async function runSkillLazyPerf(input: {
	reportPath: string;
	skillCount?: number;
	coldBudgetMs?: number;
	warmBudgetMs?: number;
}): Promise<SkillPerfReport> {
	const skillCount = Math.max(100, input.skillCount ?? DEFAULT_SKILL_COUNT);
	const coldBudgetMs = Math.max(
		200,
		input.coldBudgetMs ?? Number(process.env.SKILL_SCAN_COLD_BUDGET_MS ?? 1_000),
	);
	const warmBudgetMs = Math.max(
		50,
		input.warmBudgetMs ?? Number(process.env.SKILL_SCAN_WARM_BUDGET_MS ?? 200),
	);

	const root = await mkdtemp(join(tmpdir(), "skill-perf-"));
	let prefixReads = 0;
	let fullReads = 0;
	try {
		await writeSyntheticSkills(root, skillCount);
		const service = new SkillService({
			roots: [{ scope: "workspace", path: root }],
			readPrefix: async (path, maxBytes) => {
				prefixReads += 1;
				const body = await readFile(path);
				return body.subarray(0, maxBytes);
			},
			readSkillFile: async (path) => {
				fullReads += 1;
				return readFile(path, "utf8");
			},
		});

		const coldStart = nowMs();
		const coldList = await service.listSkills();
		const coldMs = nowMs() - coldStart;

		const warmStart = nowMs();
		const warmList = await service.listSkills();
		const warmMs = nowMs() - warmStart;

		if (coldList.length !== skillCount || warmList.length !== skillCount) {
			throw new Error(`unexpected list size cold=${coldList.length} warm=${warmList.length} expected=${skillCount}`);
		}

		await service.resolvePromptText({
			text: "/skill:skill-0000 run",
			activationKind: "explicit",
		});

		if (prefixReads < skillCount) {
			throw new Error(`prefix read underflow: ${prefixReads} < ${skillCount}`);
		}
		if (fullReads !== 1) {
			throw new Error(`full body read count must be 1 after single activation, got ${fullReads}`);
		}
		if (coldMs > coldBudgetMs) {
			throw new Error(`cold scan budget exceeded: ${coldMs}ms > ${coldBudgetMs}ms`);
		}
		if (warmMs > warmBudgetMs) {
			throw new Error(`warm scan budget exceeded: ${warmMs}ms > ${warmBudgetMs}ms`);
		}

		const report: SkillPerfReport = {
			status: "ok",
			generatedAt: new Date().toISOString(),
			skillCount,
			coldMs,
			warmMs,
			coldBudgetMs,
			warmBudgetMs,
			prefixReads,
			fullReads,
		};
		await writeJson(input.reportPath, report as unknown as Record<string, unknown>);
		return report;
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function main(): Promise<void> {
	const reportPath = process.argv[2] ?? ".cache/spec08/skills-perf.json";
	const report = await runSkillLazyPerf({ reportPath });
	console.log(
		`skill-lazy-perf ${report.status}: cold=${report.coldMs}ms warm=${report.warmMs}ms count=${report.skillCount}`,
	);
}

const entryArg = process.argv[1];
if (entryArg && import.meta.url === pathToFileURL(entryArg).href) {
	main().catch((error: unknown) => {
		console.error(error);
		process.exit(1);
	});
}
