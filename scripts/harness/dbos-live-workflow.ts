import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { DBOS } from "@dbos-inc/dbos-sdk";
import { Kysely, PostgresDialect, sql } from "kysely";
import pg from "pg";

type Mode = "first" | "recover";

const [modeArg, workflowIdArg] = process.argv.slice(2);
const mode = (modeArg as Mode | undefined) ?? "first";
const workflowID = workflowIdArg ?? "forkloom-dbos-live-wf";

if (mode !== "first" && mode !== "recover") {
	console.error(
		"usage: tsx scripts/harness/dbos-live-workflow.ts <first|recover> [workflow-id]",
	);
	process.exit(1);
}

const dbUrl = process.env.DBOS_SYSTEM_DATABASE_URL;
if (!dbUrl) {
	console.error("DBOS_SYSTEM_DATABASE_URL is required");
	process.exit(1);
}

const crashMarker = resolve(".cache/dbos/crash.once");
mkdirSync(dirname(crashMarker), { recursive: true });

const pool = new pg.Pool({ connectionString: dbUrl });
const db = new Kysely<{
	side_effects_live: {
		id: number;
		idempotency_key: string;
		phase: string;
		created_at: Date;
	};
}>({ dialect: new PostgresDialect({ pool }) });

async function setupTables(): Promise<void> {
	await sql`
    create table if not exists side_effects_live(
      id bigserial primary key,
      idempotency_key text not null,
      phase text not null,
      created_at timestamptz not null default now()
    );
  `.execute(db);

	await sql`
    create unique index if not exists once_guard_live on side_effects_live(idempotency_key, phase);
  `.execute(db);
}

async function recordPhase(
	idempotencyKey: string,
	phase: string,
): Promise<void> {
	await sql`
    insert into side_effects_live(idempotency_key, phase)
    values (${idempotencyKey}, ${phase})
    on conflict do nothing;
  `.execute(db);
}

async function countPhase(
	idempotencyKey: string,
	phase: string,
): Promise<number> {
	const result = await sql<{ count: string }>`
    select count(*)::text as count
    from side_effects_live
    where idempotency_key = ${idempotencyKey} and phase = ${phase};
  `.execute(db);
	return Number(result.rows[0]?.count ?? "0");
}

const idempotencyKey = `wf:${workflowID}`;

async function stepOne(): Promise<void> {
	await recordPhase(idempotencyKey, "step1");

	if (mode === "first" && !existsSync(crashMarker)) {
		writeFileSync(crashMarker, "crashed\n", "utf8");
		process.kill(process.pid, "SIGKILL");
	}
}

async function stepTwo(): Promise<void> {
	await recordPhase(idempotencyKey, "step2");
}

async function workflowMain(): Promise<string> {
	await DBOS.runStep(stepOne, { name: "live-step-1" });
	await DBOS.runStep(stepTwo, { name: "live-step-2" });
	return "ok";
}

const LiveWorkflow = DBOS.registerWorkflow(workflowMain, {
	name: "forkloomLiveWorkflow",
});

async function run(): Promise<void> {
	await setupTables();

	DBOS.setConfig({
		systemDatabaseUrl: dbUrl,
		runAdminServer: false,
	});
	await DBOS.launch();

	if (mode === "first") {
		const handle = await DBOS.startWorkflow(LiveWorkflow, { workflowID })();
		await handle.getResult();
		return;
	}

	const result = await DBOS.getResult<string>(workflowID, 30);
	if (result !== "ok") {
		throw new Error(`expected workflow result ok, got ${String(result)}`);
	}

	const c1 = await countPhase(idempotencyKey, "step1");
	const c2 = await countPhase(idempotencyKey, "step2");
	if (c1 !== 1 || c2 !== 1) {
		throw new Error(`exactly-once violated: step1=${c1}, step2=${c2}`);
	}

	const outPath = resolve(".cache/test-int/dbos-live.json");
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(
		outPath,
		`${JSON.stringify(
			{
				workflowID,
				result,
				counts: { step1: c1, step2: c2 },
				crashMarker: readFileSync(crashMarker, "utf8").trim(),
			},
			null,
			2,
		)}\n`,
		"utf8",
	);

	rmSync(crashMarker, { force: true });
}

run()
	.then(async () => {
		await DBOS.shutdown({ deregister: true });
		await db.destroy();
	})
	.catch(async (error: unknown) => {
		console.error(error);
		try {
			await DBOS.shutdown({ deregister: true });
		} catch {
			// ignore shutdown errors in failure path
		}
		await db.destroy();
		process.exit(1);
	});
