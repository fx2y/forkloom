import { describe, expect, it } from "vitest";
import {
	PgSandboxRepo,
	createSandboxPreviewSpec,
	createSandboxSpec,
} from "../../apps/api/src/sandbox";

type StubResult = {
	rows?: unknown[] | undefined;
	rowCount?: number | null | undefined;
};

type Call = {
	sql: string;
	params: readonly unknown[] | undefined;
};

class StubClient {
	public readonly calls: Call[] = [];

	constructor(private readonly queue: StubResult[]) {}

	async query<TRow = unknown>(
		sql: string,
		params?: readonly unknown[],
	): Promise<{ rows: TRow[]; rowCount: number | null }> {
		this.calls.push({ sql, params });
		const next = this.queue.shift() ?? {};
		return {
			rows: (next.rows ?? []) as TRow[],
			rowCount: next.rowCount ?? ((next.rows?.length ?? 0) > 0 ? 1 : 0),
		};
	}

	release(): void {
		return;
	}
}

class StubPool extends StubClient {
	async connect(): Promise<StubClient> {
		return this;
	}

	async end(): Promise<void> {
		return;
	}
}

const ISO = "2026-02-28T12:00:00.000Z";
const RUN_ID = "run-1";

const SPEC = createSandboxSpec({
	runId: RUN_ID,
	sandboxId: "sbx-1",
	profile: "priv",
	containerName: "sbx-run-1",
	workVolume: "sbx-run-1-work",
	piHomeHostDir: "/tmp/pi-home",
	piHomePath: "/pi-home",
	inputMountSource: "/tmp/inputs",
	cacheMountSource: "/tmp/cache",
	config: {
		image: "node:24-alpine",
		workdir: "/work",
		defaultTimeoutSec: 900,
		maxBytesOut: 256_000,
	},
});

function sandboxRow(overrides: Record<string, unknown> = {}) {
	return {
		run_id: RUN_ID,
		sandbox_id: "sbx-1",
		backend: "docker",
		profile: "priv",
		state: "missing",
		approval_state: "pending",
		spec: SPEC,
		preview_spec: createSandboxPreviewSpec(SPEC),
		container_name: "sbx-run-1",
		work_volume: "sbx-run-1-work",
		inflight_workflow_id: null,
		lease_expires_at: null,
		workspace_ref: null,
		created_at: ISO,
		updated_at: ISO,
		last_seen_at: ISO,
		...overrides,
	};
}

function commandRow(overrides: Record<string, unknown> = {}) {
	return {
		run_id: RUN_ID,
		seq: 3,
		kind: "prompt",
		payload: { text: "hello" },
		dedupe_key: "cmd-1",
		state: "queued",
		claimed_by: null,
		claimed_at: null,
		lease_expires_at: null,
		done_at: null,
		error: null,
		created_at: ISO,
		...overrides,
	};
}

function execRow(overrides: Record<string, unknown> = {}) {
	return {
		exec_id: 7,
		run_id: RUN_ID,
		command_seq: 3,
		command_kind: "prompt",
		status: "done",
		exit_code: 0,
		stdout_tail: "ok\n",
		stderr_tail: "",
		stdout_bytes: 3,
		stderr_bytes: 0,
		timeout_sec: 60,
		max_bytes_out: 256_000,
		stdout_ref: null,
		stderr_ref: null,
		workspace_ref: "a".repeat(64),
		started_at: ISO,
		ended_at: ISO,
		...overrides,
	};
}

describe("PgSandboxRepo", () => {
	it("creates sandboxes transactionally and keeps preview truth in SQL", async () => {
		const pool = new StubPool([{}, { rows: [sandboxRow()], rowCount: 1 }, {}]);
		const repo = new PgSandboxRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const created = await repo.createSandbox({
			runId: RUN_ID,
			spec: SPEC,
			previewSpec: createSandboxPreviewSpec(SPEC),
		});

		expect(created.created).toBe(true);
		expect(created.sandbox.approvalState).toBe("pending");
		expect(pool.calls.map((call) => call.sql.toLowerCase())).toEqual([
			"begin",
			expect.stringContaining("insert into sandbox"),
			"commit",
		]);
	});

	it("allocates command seqs in SQL and reuses dedupe hits", async () => {
		const pool = new StubPool([
			{},
			{ rows: [sandboxRow()], rowCount: 1 },
			{ rows: [], rowCount: 0 },
			{ rows: [{ seq: 3 }], rowCount: 1 },
			{ rows: [commandRow()], rowCount: 1 },
			{ rows: [{ seq: 3 }], rowCount: 1 },
			{},
		]);
		const repo = new PgSandboxRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const queued = await repo.queueCommand({
			runId: RUN_ID,
			kind: "prompt",
			payload: { text: "hello" },
			dedupeKey: "cmd-1",
		});

		expect(queued.created).toBe(true);
		expect(queued.command.seq).toBe(3);
		expect(queued.firstPendingSeq).toBe(3);
		expect(pool.calls.map((call) => call.sql.toLowerCase())).toEqual([
			"begin",
			expect.stringContaining("from sandbox"),
			expect.stringContaining("where run_id = $1 and dedupe_key = $2"),
			expect.stringContaining("update sandbox"),
			expect.stringContaining("insert into run_command"),
			expect.stringContaining("select min(seq) as seq"),
			"commit",
		]);
	});

	it("acquires lease and claims the next command with expiry-aware SQL", async () => {
		const pool = new StubPool([
			{},
			{ rows: [sandboxRow({ inflight_workflow_id: "wf-1" })], rowCount: 1 },
			{},
			{
				rows: [commandRow({ state: "claimed", claimed_by: "wf-1" })],
				rowCount: 1,
			},
		]);
		const repo = new PgSandboxRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const acquired = await repo.acquireLease({
			runId: RUN_ID,
			workflowId: "wf-1",
			leaseMs: 60_000,
		});
		const claimed = await repo.claimNextCommand({
			runId: RUN_ID,
			workflowId: "wf-1",
		});

		expect(acquired).toBe(true);
		expect(claimed?.claimedBy).toBe("wf-1");
		expect(pool.calls[1]?.sql.toLowerCase()).toContain("lease_expires_at");
		expect(pool.calls[3]?.sql.toLowerCase()).toContain(
			"for update skip locked",
		);
	});

	it("persists exec rows and advances sandbox state in one transaction", async () => {
		const pool = new StubPool([
			{},
			{ rows: [execRow()], rowCount: 1 },
			{},
			{
				rows: [sandboxRow({ state: "ready", workspace_ref: "a".repeat(64) })],
				rowCount: 1,
			},
			{ rows: [{ seq: null }], rowCount: 1 },
			{},
		]);
		const repo = new PgSandboxRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const persisted = await repo.persistExec({
			runId: RUN_ID,
			workflowId: "wf-1",
			commandSeq: 3,
			commandKind: "prompt",
			result: {
				exitCode: 0,
				status: "done",
				stdoutTail: "ok\n",
				stderrTail: "",
				stdoutBytes: 3,
				stderrBytes: 0,
				timeoutSec: 60,
				maxBytesOut: 256_000,
				startedAt: ISO,
				endedAt: ISO,
				workspaceRef: { sha256: "a".repeat(64) },
			},
		});

		expect(persisted.exec.commandSeq).toBe(3);
		expect(persisted.sandbox.state).toBe("ready");
		expect(persisted.nextPendingSeq).toBeNull();
		expect(pool.calls.map((call) => call.sql.toLowerCase())).toEqual([
			"begin",
			expect.stringContaining("insert into sandbox_exec"),
			expect.stringContaining("update run_command"),
			expect.stringContaining("update sandbox"),
			expect.stringContaining("select min(seq) as seq"),
			"commit",
		]);
	});
});
