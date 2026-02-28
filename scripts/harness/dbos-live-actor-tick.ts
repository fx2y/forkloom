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
import pg from "pg";
import {
	LazyDbosActorWorkflowLauncher,
	NoopActorBatchProcessor,
	PgActorRepo,
} from "../../apps/api/src/actor";
import { PgArtifactRepo } from "../../apps/api/src/repo/postgres";
import { registerActorTickWorkflow } from "../../apps/api/src/workflow";

type Mode = "first" | "recover";

const [modeArg, actorIdArg] = process.argv.slice(2);
const mode = (modeArg as Mode | undefined) ?? "first";
const actorId = actorIdArg ?? "actor-live-proof";

if (mode !== "first" && mode !== "recover") {
	console.error(
		"usage: tsx scripts/harness/dbos-live-actor-tick.ts <first|recover> [actor-id]",
	);
	process.exit(1);
}

const systemDatabaseUrl =
	process.env.DBOS_SYSTEM_DATABASE_URL ??
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/agentos";
const crashMarker = resolve(".cache/dbos/actor-tick.crash.once");
mkdirSync(dirname(crashMarker), { recursive: true });

const workflowID = `tick:${actorId}:1`;
const pool = new pg.Pool({ connectionString: systemDatabaseUrl });
const actorRepo = new PgActorRepo({ databaseUrl: systemDatabaseUrl });
const migrationRepo = new PgArtifactRepo({
	databaseUrl: systemDatabaseUrl,
	migrationsDir: resolve("apps/api/migrations"),
});

async function setup(): Promise<void> {
	await migrationRepo.runMigrations();
	await actorRepo.createActor({
		actorId,
		name: "live-proof",
		status: "idle",
	});
	await actorRepo.postMailboxMessage({
		actorId,
		kind: "prompt",
		text: "hello",
		attachments: [],
		dedupeKey: "live-msg-1",
	});
}

async function writeProof(): Promise<void> {
	const actorResult = await pool.query<{
		mailbox_cursor: string;
		inflight_workflow_id: string | null;
		status: string;
	}>(
		`select mailbox_cursor, inflight_workflow_id, status
		 from actor
		 where actor_id = $1`,
		[actorId],
	);
	const mailboxResult = await pool.query<{
		seq: string;
		state: string;
		claimed_by: string | null;
		done_at: string | null;
	}>(
		`select seq::text as seq, state, claimed_by, done_at::text
		 from mailbox_msg
		 where actor_id = $1
		 order by seq asc`,
		[actorId],
	);
	const eventResult = await pool.query<{ count: string }>(
		`select count(*)::text as count
		 from actor_event
		 where actor_id = $1 and kind = 'mailbox_processed'`,
		[actorId],
	);
	const lockResult = await pool.query<{ count: string }>(
		`select count(*)::text as count
		 from actor_lock
		 where actor_id = $1`,
		[actorId],
	);

	const outPath = resolve(".cache/test-int/actor-durability.json");
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(
		outPath,
		`${JSON.stringify(
			{
				workflowID,
				actorId,
				crashMarker: readFileSync(crashMarker, "utf8").trim(),
				actor: actorResult.rows[0] ?? null,
				messages: mailboxResult.rows,
				processedEventCount: Number(eventResult.rows[0]?.count ?? "0"),
				lockCount: Number(lockResult.rows[0]?.count ?? "0"),
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	rmSync(crashMarker, { force: true });
}

async function run(): Promise<void> {
	await setup();

	DBOS.setConfig({
		systemDatabaseUrl,
		runAdminServer: false,
	});

	const launcher = new LazyDbosActorWorkflowLauncher();
	const workflow = registerActorTickWorkflow({
		repo: actorRepo,
		processor: new NoopActorBatchProcessor(),
		workflowLauncher: launcher,
		onAfterStep: async (name) => {
			if (
				mode === "first" &&
				name === "persistBatch" &&
				!existsSync(crashMarker)
			) {
				writeFileSync(crashMarker, "crashed\n", "utf8");
				process.kill(process.pid, "SIGKILL");
			}
		},
	});
	launcher.bind(workflow);

	await DBOS.launch();

	if (mode === "first") {
		await launcher.enqueueActorTick({ actorId, firstPendingSeq: 1 });
		await DBOS.getResult<void>(workflowID, 30);
		return;
	}

	await DBOS.getResult<void>(workflowID, 30);
	await writeProof();
}

run()
	.then(async () => {
		await DBOS.shutdown({ deregister: true });
		await actorRepo.close();
		await migrationRepo.close();
		await pool.end();
	})
	.catch(async (error: unknown) => {
		console.error(error);
		try {
			await DBOS.shutdown({ deregister: true });
		} catch {
			// ignore shutdown errors in failure path
		}
		await actorRepo.close();
		await migrationRepo.close();
		await pool.end();
		process.exit(1);
	});
