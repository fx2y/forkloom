import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Spec09ChecklistReport = {
	status: "ok" | "fail";
	generatedAt: string;
	reqFullCoverMiss: number;
	tasksDone: number;
	tasksTotal: number;
	taskAllDone: boolean;
	requiredTaskMissing: string[];
	requiredTaskNotDone: string[];
	c7ValidateProofOk: boolean;
	c7SmokeProofOk: boolean;
	proofMatrixOk: boolean;
};

const REQUIRED_TASK_IDS = [
	"T700",
	"T710",
	"T720",
	"T730",
	"T740",
	"T750",
	"T800",
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

function asBooleanRecord(value: unknown): Record<string, boolean> | null {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		return null;
	}
	const out: Record<string, boolean> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (typeof entry === "boolean") {
			out[key] = entry;
		}
	}
	return Object.keys(out).length > 0 ? out : null;
}

export async function collectSpec09ChecklistReport(
	input: {
		htnDbPath?: string;
		tasksDbPath?: string;
		c7ValidatePath?: string;
		c7SmokePath?: string;
		matrixPath?: string;
	} = {},
): Promise<Spec09ChecklistReport> {
	const htnDbPath = input.htnDbPath ?? "spec-0/09-htn.sqlite";
	const tasksDbPath = input.tasksDbPath ?? "spec-0/09-tasks.sqlite";
	const c7ValidatePath =
		input.c7ValidatePath ?? ".cache/spec09/c7-validate.json";
	const c7SmokePath = input.c7SmokePath ?? ".cache/spec09/c7-smoke.json";
	const matrixPath = input.matrixPath ?? ".cache/spec09/cy8-proof-matrix.json";

	const reqRows = await queryJson(
		htnDbPath,
		"select count(*) as req_full_cover_miss from req r left join req_cover c on c.req_id=r.id and c.fit='full' where c.req_id is null;",
	);
	const reqFullCoverMiss = Number(reqRows[0]?.req_full_cover_miss ?? 0);

	const taskSummaryRows = await queryJson(
		tasksDbPath,
		"select sum(case when status='done' then 1 else 0 end) as tasks_done, count(*) as tasks_total from task where ord between 700 and 850;",
	);
	const tasksDone = Number(taskSummaryRows[0]?.tasks_done ?? 0);
	const tasksTotal = Number(taskSummaryRows[0]?.tasks_total ?? 0);
	const taskAllDone = tasksTotal === 12 && tasksDone === tasksTotal;

	const requiredRows = await queryJson(
		tasksDbPath,
		`select id, status from task where id in (${REQUIRED_TASK_IDS.map((id) => `'${id}'`).join(",")});`,
	);
	const requiredById = new Map(
		requiredRows.map((row) => [String(row.id), String(row.status)]),
	);
	const requiredTaskMissing = REQUIRED_TASK_IDS.filter(
		(id) => !requiredById.has(id),
	);
	const requiredTaskNotDone = REQUIRED_TASK_IDS.filter(
		(id) => requiredById.get(id) != null && requiredById.get(id) !== "done",
	);

	const c7Validate = await readProofJson(c7ValidatePath);
	const c7Smoke = await readProofJson(c7SmokePath);
	const matrix = await readProofJson(matrixPath);

	const c7ValidateProofOk = c7Validate?.status === "ok";
	const c7SmokeProofOk = c7Smoke?.status === "ok";
	const validateBooleans = asBooleanRecord(c7Validate?.booleans);
	const smokeBoolean =
		c7Smoke?.apiHealthStable === true &&
		c7Smoke?.routeBanAstAnchor === true &&
		c7Smoke?.scopeGuardMark === true;
	const derivedMatrix: Record<string, boolean> = {
		ext: validateBooleans?.ext_ok === true,
		pkg: validateBooleans?.pkg_ok === true,
		theme: validateBooleans?.theme_ok === true,
		ux: validateBooleans?.ux_ok === true,
		headless: validateBooleans?.headless_ok === true,
		stream: validateBooleans?.stream_ok === true,
		sandbox: validateBooleans?.sandbox_ok === true,
		smoke: smokeBoolean,
	};
	const fileMatrix = asBooleanRecord(matrix?.matrix);
	const effectiveMatrix = fileMatrix ?? derivedMatrix;
	const proofMatrixOk =
		(matrix == null || matrix.status === "ok") &&
		Object.values(effectiveMatrix).every((value) => value === true);

	const status =
		reqFullCoverMiss === 0 &&
		taskAllDone &&
		requiredTaskMissing.length === 0 &&
		requiredTaskNotDone.length === 0 &&
		c7ValidateProofOk &&
		c7SmokeProofOk &&
		proofMatrixOk
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
		c7ValidateProofOk,
		c7SmokeProofOk,
		proofMatrixOk,
	};
}

export function hasSpec09ChecklistViolations(
	report: Spec09ChecklistReport,
): boolean {
	return report.status !== "ok";
}

export function formatSpec09ChecklistSummary(
	report: Spec09ChecklistReport,
): string {
	return [
		`req_full_cover_miss=${report.reqFullCoverMiss}`,
		`task_done=${report.tasksDone}`,
		`task_total=${report.tasksTotal}`,
		`task_all_done=${report.taskAllDone ? 1 : 0}`,
		`required_missing=${report.requiredTaskMissing.length}`,
		`required_not_done=${report.requiredTaskNotDone.length}`,
		`c7_validate_ok=${report.c7ValidateProofOk ? 1 : 0}`,
		`c7_smoke_ok=${report.c7SmokeProofOk ? 1 : 0}`,
		`proof_matrix_ok=${report.proofMatrixOk ? 1 : 0}`,
	].join(", ");
}
