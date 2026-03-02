import { execFile } from "node:child_process";
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

export async function collectSpec08ChecklistReport(input: {
	htnDbPath?: string;
	tasksDbPath?: string;
} = {}): Promise<Spec08ChecklistReport> {
	const htnDbPath = input.htnDbPath ?? "spec-0/08-htn.sqlite";
	const tasksDbPath = input.tasksDbPath ?? "spec-0/08-tasks.sqlite";

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

	const status =
		reqFullCoverMiss === 0 &&
		taskAllDone &&
		requiredTaskMissing.length === 0 &&
		requiredTaskNotDone.length === 0
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
	].join(", ");
}
