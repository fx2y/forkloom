import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
import { registerRunSandboxWorkflow } from "../../apps/api/src/workflow";

type Mode = "first" | "recover";

const [modeArg, workflowIdArg] = process.argv.slice(2);
const mode = (modeArg as Mode | undefined) ?? "first";
const workflowID = workflowIdArg ?? "forkloom-run-sandbox-live-wf";

if (mode !== "first" && mode !== "recover") {
	console.error(
		"usage: tsx scripts/harness/dbos-live-run-sandbox.ts <first|recover> [workflow-id]",
	);
	process.exit(1);
}

const systemDatabaseUrl =
	process.env.DBOS_SYSTEM_DATABASE_URL ??
	process.env.DATABASE_URL ??
	"postgresql://postgres:postgres@127.0.0.1:5432/agentos";
const crashMarker = resolve(".cache/dbos/run-sandbox.crash.once");
mkdirSync(dirname(crashMarker), { recursive: true });

const runId = workflowID;
const pool = new pg.Pool({ connectionString: systemDatabaseUrl });
const inputRoot = mkdtempSync(join(tmpdir(), "forkloom-run-sandbox-live-"));

function sampleRun() {
	return {
		runId,
		status: "queued" as const,
		spec: {
			runId,
			scope: "team" as const,
			userMsg: "ship it",
			attachments: [{ sha256: "a".repeat(64) }],
			profile: "safe" as const,
		},
		createdAt: "2026-02-28T00:00:00.000Z",
		updatedAt: "2026-02-28T00:00:00.000Z",
		dbosWorkflowId: null,
		piSessionId: null,
		piSessionFile: null,
		resultText: null,
		resultStats: null,
		error: null,
	};
}

function sampleSandbox() {
	return {
		runId,
		sandboxId: "sbx-live",
		backend: "docker" as const,
		profile: "safe" as const,
		state: "ready" as const,
		approvalState: "not_required" as const,
		spec: {
			runId,
			sandboxId: "sbx-live",
			profile: "safe" as const,
			backend: "docker" as const,
			imageDigest: "node:24-alpine",
			containerName: "sbx-live",
			workVolume: "sbx-live-work",
			workdir: "/work",
			piHomeHostDir: inputRoot,
			piHomePath: "/pi-home",
			mounts: [
				{
					kind: "inputs" as const,
					source: inputRoot,
					dest: "/inputs",
					mode: "ro" as const,
				},
			],
			env: {},
			network: "off" as const,
			cpuMillicores: 1000,
			memoryMb: 1024,
			diskMb: 1024,
			timeoutSec: 900,
			maxBytesOut: 1024,
		},
		previewSpec: {
			imageDigest: "node:24-alpine",
			profile: "safe" as const,
			network: "off" as const,
			containerName: "sbx-live",
			workVolume: "sbx-live-work",
			workdir: "/work",
			timeoutSec: 900,
			maxBytesOut: 1024,
			mounts: [],
		},
		containerName: "sbx-live",
		workVolume: "sbx-live-work",
		inflightWorkflowId: null,
		leaseExpiresAt: null,
		workspaceRef: undefined,
		createdAt: "2026-02-28T00:00:00.000Z",
		updatedAt: "2026-02-28T00:00:00.000Z",
		lastSeenAt: "2026-02-28T00:00:00.000Z",
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
		await recordEffect("get_state");
		return {
			sessionFile: "/tmp/run-sandbox-live.session.jsonl",
			sessionId: "run-sandbox-live-session",
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
		await recordEffect("close_session");
	}
}

async function setupTables(): Promise<void> {
	await pool.query(`
		create table if not exists run_sandbox_live_effects(
			run_id text not null,
			effect text not null,
			created_at timestamptz not null default now(),
			primary key(run_id, effect)
		)
	`);
}

async function recordEffect(effect: string): Promise<void> {
	await pool.query(
		`insert into run_sandbox_live_effects(run_id, effect)
		 values($1, $2)
		 on conflict do nothing`,
		[runId, effect],
	);
}

async function countEffect(effect: string): Promise<number> {
	const result = await pool.query<{ count: string }>(
		`select count(*)::text as count
		 from run_sandbox_live_effects
		 where run_id = $1 and effect = $2`,
		[runId, effect],
	);
	return Number(result.rows[0]?.count ?? "0");
}

async function createPiSession(): Promise<PiSessionPort> {
	await recordEffect("create_pi");
	return new StubSession();
}

async function writeProof(): Promise<void> {
	const effects = [
		"acquire_lease",
		"claim_command",
		"load_run",
		"load_sandbox",
		"ensure_sandbox",
		"read_attachment",
		"create_pi",
		"run_started",
		"prompt",
		"pi_event",
		"get_state",
		"persist_session",
		"link_pi_session_jsonl",
		"artifact_pi_session_jsonl",
		"snapshot",
		"link_workspace_snapshot",
		"artifact_workspace_snapshot",
		"workspace_updated",
		"persist_exec",
		"release_lease",
	];
	const counts = Object.fromEntries(
		await Promise.all(
			effects.map(
				async (effect) => [effect, await countEffect(effect)] as const,
			),
		),
	);
	const outPath = resolve(".cache/test-int/run-sandbox-durability.json");
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

	const workflow = registerRunSandboxWorkflow({
		runRepo: {
			getRun: async () => {
				await recordEffect("load_run");
				return sampleRun();
			},
		},
		runService: {
			appendArtifactWritten: async (_runId, payload) => {
				const kind =
					typeof payload.kind === "string" ? payload.kind : "artifact_unknown";
				await recordEffect(`artifact_${kind}`);
				return {
					eventId: 1,
					runId,
					kind: "artifact_written",
					payload,
					createdAt: "2026-02-28T00:00:01.000Z",
				};
			},
			appendPiEvent: async (_runId, payload) => {
				await recordEffect("pi_event");
				return {
					eventId: 2,
					runId,
					kind: "pi_event",
					payload,
					createdAt: "2026-02-28T00:00:02.000Z",
				};
			},
			appendRunEvent: async (_runId, kind, payload) => {
				await recordEffect(kind);
				return {
					eventId: 3,
					runId,
					kind,
					payload,
					createdAt: "2026-02-28T00:00:03.000Z",
				};
			},
			beginRun: async () => {
				await recordEffect("run_started");
				return {
					eventId: 4,
					runId,
					kind: "run_started",
					payload: {},
					createdAt: "2026-02-28T00:00:04.000Z",
				};
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
			getArtifactBytes: async () => {
				if (mode === "first" && !existsSync(crashMarker)) {
					writeFileSync(crashMarker, "crashed\n", "utf8");
					process.kill(process.pid, "SIGKILL");
				}
				await recordEffect("read_attachment");
				return {
					body: Readable.from(Buffer.from("attachment\n", "utf8")),
					contentType: "text/plain",
				};
			},
			getArtifactMeta: async () => ({
				sha256: "a".repeat(64),
				uri: "s3://agentos/cas/aa/aaaa",
				mime: "text/plain",
				bytes: 11,
				createdAt: "2026-02-28T00:00:00.000Z",
				type: "raw" as const,
				parents: [],
				meta: {},
			}),
			putArtifact: async (input) => {
				const streamKind =
					typeof input.meta?.["run.exec.stream"] === "string"
						? input.meta["run.exec.stream"]
						: null;
				if (streamKind === "stdout") {
					await recordEffect("persist_stdout");
					return {
						sha256: "c".repeat(64),
						uri: "s3://agentos/cas/cc/cccc",
						mime: "text/plain",
						bytes: 7,
						createdAt: "2026-02-28T00:00:05.000Z",
						type: "trace",
						parents: [],
						meta: {},
					};
				}
				if (streamKind === "stderr") {
					await recordEffect("persist_stderr");
					return {
						sha256: "d".repeat(64),
						uri: "s3://agentos/cas/dd/dddd",
						mime: "text/plain",
						bytes: 1,
						createdAt: "2026-02-28T00:00:05.000Z",
						type: "trace",
						parents: [],
						meta: {},
					};
				}
				await recordEffect("persist_session");
				return {
					sha256: "b".repeat(64),
					uri: "s3://agentos/cas/bb/bbbb",
					mime: "application/jsonl",
					bytes: 5,
					createdAt: "2026-02-28T00:00:05.000Z",
					type: "trace",
					parents: [],
					meta: {},
				};
			},
		},
		sandboxRepo: {
			acquireLease: async () => {
				await recordEffect("acquire_lease");
				return true;
			},
			claimNextCommand: async () => {
				await recordEffect("claim_command");
				return {
					runId,
					seq: 1,
					kind: "prompt" as const,
					payload: { text: "ship it" },
					dedupeKey: "init",
					state: "claimed" as const,
					claimedBy: workflowID,
					claimedAt: "2026-02-28T00:00:00.000Z",
					leaseExpiresAt: null,
					doneAt: null,
					error: null,
					createdAt: "2026-02-28T00:00:00.000Z",
				};
			},
			getSandbox: async () => {
				await recordEffect("load_sandbox");
				return sampleSandbox();
			},
			getCurrentCommand: async () => null,
			markApproved: async () => sampleSandbox(),
			markCommandDead: async () => null,
			persistExec: async () => {
				await recordEffect("persist_exec");
				return {
					exec: {
						execId: 1,
						runId,
						commandSeq: 1,
						commandKind: "prompt" as const,
						status: "done" as const,
						exitCode: 0,
						cmdList: ["prompt", "ship it"],
						artifactReads: [{ sha256: "a".repeat(64) }],
						artifactWrites: [
							{ sha256: "b".repeat(64) },
							{ sha256: "c".repeat(64) },
						],
						stdoutTail: "",
						stderrTail: "",
						stdoutBytes: 0,
						stderrBytes: 0,
						timeoutSec: 900,
						maxBytesOut: 1024,
						startedAt: "2026-02-28T00:00:06.000Z",
						endedAt: "2026-02-28T00:00:07.000Z",
					},
					sandbox: sampleSandbox(),
					nextPendingSeq: null,
				};
			},
			requeueCommand: async () => null,
			releaseLease: async () => {
				await recordEffect("release_lease");
			},
		},
		backend: {
			ensure: async () => {
				await recordEffect("ensure_sandbox");
				return sampleSandbox();
			},
			exec: async () => {
				await recordEffect("collect_exec");
				return {
					exitCode: 0,
					status: "done",
					cmdList: ["sh", "-lc", "tail"],
					artifactReads: [{ sha256: "a".repeat(64) }],
					artifactWrites: [],
					stdoutTail: "result\n",
					stderrTail: "",
					stdoutBytes: 7,
					stderrBytes: 0,
					timeoutSec: 900,
					maxBytesOut: 1024,
					startedAt: "2026-02-28T00:00:06.000Z",
					endedAt: "2026-02-28T00:00:07.000Z",
				};
			},
			snapshot: async () => {
				await recordEffect("snapshot");
				return { sha256: "c".repeat(64) };
			},
			destroy: async () => null,
		},
		workflowLauncher: {
			startRunOnce: async () => undefined,
		},
		createPiSession: async () => createPiSession(),
		readFileBytes: async () => Buffer.from("line\n", "utf8"),
	});

	await DBOS.launch();

	if (mode === "first") {
		const handle = await DBOS.startWorkflow(workflow, { workflowID })(runId);
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
