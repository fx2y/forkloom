import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { Readable } from "node:stream";
import { DBOS } from "@dbos-inc/dbos-sdk";
import pg from "pg";
import type {
	PiPromptInput,
	PiSessionPort,
	PiSessionState,
	PiSessionStats,
} from "../../apps/api/src/pi";
import { registerRunOnceWorkflow } from "../../apps/api/src/workflow";

type Mode = "first" | "recover";

const [modeArg, workflowIdArg] = process.argv.slice(2);
const mode = (modeArg as Mode | undefined) ?? "first";
const workflowID = workflowIdArg ?? "forkloom-runonce-live-wf";

if (mode !== "first" && mode !== "recover") {
	console.error(
		"usage: tsx scripts/harness/dbos-live-runonce.ts <first|recover> [workflow-id]",
	);
	process.exit(1);
}

const systemDatabaseUrl =
	process.env.DBOS_SYSTEM_DATABASE_URL ??
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/agentos";
const crashMarker = resolve(".cache/dbos/runonce.crash.once");
mkdirSync(dirname(crashMarker), { recursive: true });

const runId = workflowID;
const pool = new pg.Pool({ connectionString: systemDatabaseUrl });

function sampleRun() {
	return {
		runId,
		status: "running" as const,
		spec: {
			runId,
			scope: "team" as const,
			userMsg: "reply with one concise line",
			attachments: [{ sha256: "a".repeat(64) }],
			orgId: "00000000-0000-0000-0000-000000000001",
			writeTarget: "ws" as const,
		},
		createdAt: "2026-02-27T00:00:00.000Z",
		updatedAt: "2026-02-27T00:00:00.000Z",
		dbosWorkflowId: runId,
		piSessionId: null,
		piSessionFile: null,
		resultText: null,
		resultStats: {},
		error: null,
	};
}

class StubSession implements PiSessionPort {
	async prompt(_input: PiPromptInput): Promise<void> {
		await recordEffect("prompt");
	}

	async steer(_message: string): Promise<void> {
		return;
	}

	async followUp(_message: string): Promise<void> {
		return;
	}

	async setQueueMode(): Promise<void> {
		return;
	}

	async abort(): Promise<void> {
		return;
	}

	async getState(): Promise<PiSessionState> {
		return {
			sessionFile: "/tmp/runonce-live.session.jsonl",
			sessionId: "runonce-live-session",
			isStreaming: false,
			pending: 0,
		};
	}

	async getLastAssistantText(): Promise<string> {
		return "done";
	}

	async getSessionStats(): Promise<PiSessionStats> {
		return { totalTokens: 2, costUsd: 0.001 };
	}

	drainPendingEvents(): Record<string, unknown>[] {
		return [];
	}

	async waitUntilIdle(options?: {
		onEvent?:
			| ((event: Record<string, unknown>) => Promise<void> | void)
			| undefined;
	}): Promise<void> {
		if (options?.onEvent) {
			await options.onEvent({ type: "agent_event", chunk: "ok" });
		}
	}

	async close(): Promise<void> {
		return;
	}
}

async function setupTables(): Promise<void> {
	await pool.query(`
		create table if not exists runonce_live_effects(
			run_id text not null,
			effect text not null,
			created_at timestamptz not null default now(),
			primary key(run_id, effect)
		)
	`);
}

async function recordEffect(effect: string): Promise<void> {
	await pool.query(
		`insert into runonce_live_effects(run_id, effect)
		 values($1, $2)
		 on conflict do nothing`,
		[runId, effect],
	);
}

async function countEffect(effect: string): Promise<number> {
	const result = await pool.query<{ count: string }>(
		`select count(*)::text as count
		 from runonce_live_effects
		 where run_id = $1 and effect = $2`,
		[runId, effect],
	);
	return Number(result.rows[0]?.count ?? "0");
}

async function createPiSession(): Promise<PiSessionPort> {
	if (mode === "first" && !existsSync(crashMarker)) {
		writeFileSync(crashMarker, "crashed\n", "utf8");
		process.kill(process.pid, "SIGKILL");
	}
	await recordEffect("start_pi");
	return new StubSession();
}

async function writeProof(): Promise<void> {
	const effects = [
		"run_started",
		"link_input_attachment",
		"artifact_input_attachment",
		"start_pi",
		"prompt",
		"pi_event",
		"persist_session",
		"link_pi_session_jsonl",
		"artifact_pi_session_jsonl",
		"run_done",
	];
	const counts = Object.fromEntries(
		await Promise.all(
			effects.map(
				async (effect) => [effect, await countEffect(effect)] as const,
			),
		),
	);
	const outPath = resolve(".cache/test-int/runonce-live.json");
	mkdirSync(dirname(outPath), { recursive: true });
	writeFileSync(
		outPath,
		`${JSON.stringify(
			{
				workflowID,
				runId,
				counts,
				crashMarker: readFileSync(crashMarker, "utf8").trim(),
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	rmSync(crashMarker, { force: true });
}

async function run(): Promise<void> {
	await setupTables();

	DBOS.setConfig({
		systemDatabaseUrl,
		runAdminServer: false,
	});

	const workflow = registerRunOnceWorkflow({
		runRepo: {
			getRun: async () => sampleRun(),
		},
		runService: {
			beginRun: async () => {
				await recordEffect("run_started");
				return {
					eventId: 1,
					runId,
					kind: "run_started",
					payload: {},
					createdAt: "2026-02-27T00:00:00.000Z",
				};
			},
			appendPiEvent: async () => {
				await recordEffect("pi_event");
				return {
					eventId: 2,
					runId,
					kind: "pi_event",
					payload: {},
					createdAt: "2026-02-27T00:00:01.000Z",
				};
			},
			appendArtifactWritten: async (_runId, payload) => {
				const kind =
					typeof payload.kind === "string" ? payload.kind : "artifact_unknown";
				await recordEffect(`artifact_${kind}`);
				return {
					eventId: 3,
					runId,
					kind: "artifact_written",
					payload,
					createdAt: "2026-02-27T00:00:02.000Z",
				};
			},
			completeRun: async () => {
				await recordEffect("run_done");
				return sampleRun();
			},
			failRun: async (_runId, error) => {
				throw new Error(`unexpected failRun: ${String(error)}`);
			},
			linkArtifact: async (_runId, _sha256, kind) => {
				await recordEffect(`link_${kind}`);
			},
			recordStepLedger: async () => {
				await recordEffect("record_step_ledger");
			},
		},
		artifactService: {
			getArtifactMeta: async (sha256) => ({
				sha256,
				uri: `s3://agentos/cas/${sha256}`,
				mime: "text/plain",
				bytes: 5,
				createdAt: "2026-02-27T00:00:03.000Z",
				type: "raw" as const,
				parents: [],
				meta: {},
			}),
			getArtifactBytes: async () => ({
				body: Readable.from(Buffer.from("attachment\n", "utf8")),
				contentType: "text/plain",
			}),
			putArtifact: async () => {
				await recordEffect("persist_session");
				return {
					sha256: "c".repeat(64),
					uri: "s3://agentos/cas/cc/cccc",
					mime: "application/jsonl",
					bytes: 5,
					createdAt: "2026-02-27T00:00:03.000Z",
					type: "trace",
					parents: [],
					meta: {},
				};
			},
		},
		createPiSession: async () => createPiSession(),
		readFileBytes: async () => Buffer.from("line\n"),
	});

	await DBOS.launch();

	if (mode === "first") {
		const handle = await DBOS.startWorkflow(workflow, { workflowID })({
			runId,
			scope: {
				orgId: "00000000-0000-0000-0000-000000000001",
				writeTarget: "ws",
			},
		});
		await handle.getResult();
		return;
	}

	await DBOS.getResult<void>(workflowID, 30);
	await writeProof();
}

run()
	.then(async () => {
		await DBOS.shutdown({ deregister: true });
		await pool.end();
	})
	.catch(async (error: unknown) => {
		console.error(error);
		try {
			await DBOS.shutdown({ deregister: true });
		} catch {
			// ignore shutdown errors in failure path
		}
		await pool.end();
		process.exit(1);
	});
