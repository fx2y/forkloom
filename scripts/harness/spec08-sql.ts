import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Spec08ChecklistReport = {
	status: "ok" | "fail";
	generatedAt: string;
	reqFullCoverMiss: number;
	tasksDone: number;
	tasksTotal: number;
	taskAllDone: boolean;
	requiredTaskMissing: string[];
	requiredTaskNotDone: string[];
	skillsValidateProofOk: boolean;
	packsDynamicProofOk: boolean;
	skillLiveProofOk: boolean;
};

const REQUIRED_TASK_IDS = [
	"T610",
	"T620",
	"T630",
	"T640",
	"T650",
	"T710",
	"T720",
	"T730",
	"T740",
	"T750",
	"T810",
	"T820",
	"T830",
	"T840",
	"T850",
] as const;

async function queryJson(
	dbPath: string,
	sql: string,
): Promise<Array<Record<string, unknown>>> {
	const { stdout } = await execFileAsync("sqlite3", ["-json", dbPath, sql]);
	const trimmed = stdout.trim();
	if (trimmed.length === 0) {
		return [];
	}
	return JSON.parse(trimmed) as Array<Record<string, unknown>>;
}

async function readProofJson(
	path: string,
): Promise<Record<string, unknown> | null> {
	try {
		const content = await readFile(path, "utf8");
		const parsed = JSON.parse(content) as unknown;
		return parsed && typeof parsed === "object"
			? (parsed as Record<string, unknown>)
			: null;
	} catch {
		return null;
	}
}

export async function collectSpec08ChecklistReport(input: {
	htnDbPath?: string;
	tasksDbPath?: string;
	validateReportPath?: string;
	packProofPath?: string;
	skillLiveProofPath?: string;
} = {}): Promise<Spec08ChecklistReport> {
	const htnDbPath = input.htnDbPath ?? "spec-0/08-htn.sqlite";
	const tasksDbPath = input.tasksDbPath ?? "spec-0/08-tasks.sqlite";
	const validateReportPath =
		input.validateReportPath ?? ".cache/spec08/skills-validate.json";
	const packProofPath =
		input.packProofPath ?? ".cache/spec08/skills-pack-proof.json";
	const skillLiveProofPath =
		input.skillLiveProofPath ?? ".cache/spec08/skills-live-proof.json";

	const reqRows = await queryJson(
		htnDbPath,
		"select count(*) as req_full_cover_miss from req r left join req_cover c on c.req_id=r.id and c.fit='full' where c.req_id is null;",
	);
	const reqFullCoverMiss = Number(reqRows[0]?.req_full_cover_miss ?? 0);

	const taskSummaryRows = await queryJson(
		tasksDbPath,
		"select sum(case when status='done' then 1 else 0 end) as tasks_done, count(*) as tasks_total from task;",
	);
	const tasksDone = Number(taskSummaryRows[0]?.tasks_done ?? 0);
	const tasksTotal = Number(taskSummaryRows[0]?.tasks_total ?? 0);
	const taskAllDone = tasksTotal > 0 && tasksDone === tasksTotal;

	const requiredRows = await queryJson(
		tasksDbPath,
		`select id, status from task where id in (${REQUIRED_TASK_IDS.map((id) => `'${id}'`).join(",")});`,
	);
	const requiredById = new Map(
		requiredRows.map((row) => [String(row.id), String(row.status)]),
	);
	const requiredTaskMissing = REQUIRED_TASK_IDS.filter((id) => !requiredById.has(id));
	const requiredTaskNotDone = REQUIRED_TASK_IDS.filter(
		(id) => requiredById.get(id) != null && requiredById.get(id) !== "done",
	);
	const validateReport = await readProofJson(validateReportPath);
	const packProof = await readProofJson(packProofPath);
	const skillLiveProof = await readProofJson(skillLiveProofPath);
	const skillsValidateProofOk =
		validateReport?.status === "ok" &&
		typeof validateReport?.xmlBytes === "number" &&
		Number(validateReport.xmlBytes) > 0 &&
		Array.isArray(validateReport?.dynamicPacks) &&
		validateReport.dynamicPacks.length >= 4;
	const packsDynamicProofOk =
		packProof?.status === "ok" &&
		Array.isArray(packProof?.proofs) &&
		packProof.proofs.length >= 4;
	const skillLiveProofOk =
		skillLiveProof?.status === "ok" &&
		(typeof skillLiveProof?.runStatus === "string" &&
			["running", "done", "failed", "aborted"].includes(
				String(skillLiveProof.runStatus),
			)) &&
		typeof skillLiveProof?.skillExecStepCount === "number" &&
		Number(skillLiveProof.skillExecStepCount) >= 1;

	const status =
		reqFullCoverMiss === 0 &&
		taskAllDone &&
		requiredTaskMissing.length === 0 &&
		requiredTaskNotDone.length === 0 &&
		skillsValidateProofOk &&
		packsDynamicProofOk &&
		skillLiveProofOk
			? "ok"
			: "fail";
	return {
		status,
		generatedAt: new Date().toISOString(),
		reqFullCoverMiss,
		tasksDone,
		tasksTotal,
		taskAllDone,
		requiredTaskMissing,
		requiredTaskNotDone,
		skillsValidateProofOk,
		packsDynamicProofOk,
		skillLiveProofOk,
	};
}

export function hasSpec08ChecklistViolations(
	report: Spec08ChecklistReport,
): boolean {
	return report.status !== "ok";
}

export function formatSpec08ChecklistSummary(
	report: Spec08ChecklistReport,
): string {
	return [
		`req_full_cover_miss=${report.reqFullCoverMiss}`,
		`task_done=${report.tasksDone}`,
		`task_total=${report.tasksTotal}`,
		`task_all_done=${report.taskAllDone ? 1 : 0}`,
		`required_missing=${report.requiredTaskMissing.length}`,
		`required_not_done=${report.requiredTaskNotDone.length}`,
		`validate_proof_ok=${report.skillsValidateProofOk ? 1 : 0}`,
		`pack_proof_ok=${report.packsDynamicProofOk ? 1 : 0}`,
		`skill_live_ok=${report.skillLiveProofOk ? 1 : 0}`,
	].join(", ");
}
