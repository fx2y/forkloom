import { describe, expect, it } from "vitest";
import type { RunScope } from "../../apps/api/src/run/ports";
import { PgRunRepo } from "../../apps/api/src/run/repo/postgres";

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

const RUN_ID = "01HS7Z6E5R4W6NED8MH4D9Y6A0";
const ISO = "2026-02-27T00:00:00.000Z";

function runRow(overrides: Record<string, unknown> = {}) {
	return {
		run_id: RUN_ID,
		status: "queued",
		spec: {
			runId: RUN_ID,
			scope: "team" as RunScope,
			userMsg: "hello",
			attachments: [],
		},
		created_at: ISO,
		updated_at: ISO,
		dbos_workflow_id: null,
		pi_session_id: null,
		pi_session_file: null,
		result_text: null,
		result_stats: {},
		error: null,
		...overrides,
	};
}

function stepRow(overrides: Record<string, unknown> = {}) {
	return {
		run_id: RUN_ID,
		step_name: "run_command",
		attempt: 1,
		step_key: "prompt:1",
		in_hash: "in",
		out_hash: "out",
		started_at: ISO,
		ended_at: ISO,
		...overrides,
	};
}

function linkRow(overrides: Record<string, unknown> = {}) {
	return {
		run_id: RUN_ID,
		step_name: "run_command",
		attempt: 1,
		session_entry_ids: ["entry-1"],
		artifact_shas: ["a".repeat(64)],
		note: "ok",
		created_at: ISO,
		...overrides,
	};
}

function stepPayloadRow(overrides: Record<string, unknown> = {}) {
	return {
		run_id: RUN_ID,
		step_name: "run_command",
		attempt: 1,
		payload: { x: 1 },
		created_at: ISO,
		...overrides,
	};
}

describe("PgRunRepo", () => {
	it("creates run transactionally and returns created=true", async () => {
		const pool = new StubPool([{}, { rows: [runRow()], rowCount: 1 }, {}]);
		const repo = new PgRunRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const out = await repo.createRun({
			runId: RUN_ID,
			spec: {
				runId: RUN_ID,
				scope: "team",
				userMsg: "hello",
				attachments: [],
			},
		});

		expect(out.created).toBe(true);
		expect(out.run.status).toBe("queued");
		expect(out.run.dbosWorkflowId).toBeNull();
		expect(pool.calls.map((c) => c.sql.toLowerCase())).toEqual([
			"begin",
			expect.stringContaining("insert into runs"),
			"commit",
		]);
	});

	it("handles create race by selecting existing row", async () => {
		const pool = new StubPool([
			{},
			{ rows: [], rowCount: 0 },
			{ rows: [runRow({ status: "queued" })], rowCount: 1 },
			{},
		]);
		const repo = new PgRunRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const out = await repo.createRun({
			runId: RUN_ID,
			spec: {
				runId: RUN_ID,
				scope: "team",
				userMsg: "hello",
				attachments: [],
			},
		});

		expect(out.created).toBe(false);
		expect(out.run.status).toBe("queued");
		expect(pool.calls[2]?.sql.toLowerCase()).toContain("select run_id");
	});

	it("appends events and lists by strict cursor ordering", async () => {
		const pool = new StubPool([
			{
				rows: [
					{
						event_id: 2,
						run_id: RUN_ID,
						kind: "pi_event",
						payload: { chunk: "x" },
						created_at: ISO,
					},
				],
				rowCount: 1,
			},
			{
				rows: [
					{
						event_id: 3,
						run_id: RUN_ID,
						kind: "run_done",
						payload: { ok: true },
						created_at: ISO,
					},
				],
				rowCount: 1,
			},
		]);
		const repo = new PgRunRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const inserted = await repo.appendEvent({
			runId: RUN_ID,
			kind: "pi_event",
			payload: { chunk: "x" },
		});
		const listed = await repo.listEventsSince(RUN_ID, 2, 9999);

		expect(inserted.eventId).toBe(2);
		expect(listed).toHaveLength(1);
		expect(listed[0]?.eventId).toBe(3);
		expect(pool.calls[1]?.sql.toLowerCase()).toContain("event_id > $2");
		expect(pool.calls[1]?.sql.toLowerCase()).toContain("order by event_id asc");
		expect(pool.calls[1]?.params).toEqual([RUN_ID, 2, 1000]);
	});

	it("records workflow launch without mutating queued status", async () => {
		const pool = new StubPool([
			{ rows: [runRow({ dbos_workflow_id: RUN_ID })] },
		]);
		const repo = new PgRunRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const updated = await repo.recordWorkflowLaunch(RUN_ID, RUN_ID);

		expect(updated?.status).toBe("queued");
		expect(updated?.dbosWorkflowId).toBe(RUN_ID);
	});

	it("wraps terminal row + event writes in one transaction", async () => {
		const pool = new StubPool([
			{},
			{
				rows: [runRow({ status: "done", dbos_workflow_id: RUN_ID })],
				rowCount: 1,
			},
			{
				rows: [
					{
						event_id: 4,
						run_id: RUN_ID,
						kind: "run_done",
						payload: { resultText: "done", artifacts: [], stats: {} },
						created_at: ISO,
					},
				],
				rowCount: 1,
			},
			{},
		]);
		const repo = new PgRunRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const completed = await repo.completeRun({
			runId: RUN_ID,
			resultText: "done",
			resultStats: {},
			eventPayload: { resultText: "done", artifacts: [], stats: {} },
			piSessionId: "pi-session-1",
			piSessionFile: "s3://agentos/cas/cc/cccc",
		});

		expect(completed.run?.status).toBe("done");
		expect(completed.event?.kind).toBe("run_done");
		expect(pool.calls.map((call) => call.sql.toLowerCase())).toEqual([
			"begin",
			expect.stringContaining("update runs"),
			expect.stringContaining("insert into events"),
			"commit",
		]);
	});

	it("serializes link arrays and step payload json through sql casts", async () => {
		const pool = new StubPool([
			{ rows: [stepRow()], rowCount: 1 },
			{ rows: [linkRow()], rowCount: 1 },
			{ rows: [stepPayloadRow()], rowCount: 1 },
		]);
		const repo = new PgRunRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		await repo.createStep({
			runId: RUN_ID,
			stepName: "run_command",
			attempt: 1,
			stepKey: "prompt:1",
			inHash: "in",
			outHash: "out",
		});
		await repo.upsertLink({
			runId: RUN_ID,
			stepName: "run_command",
			attempt: 1,
			sessionEntryIds: ["entry-1", "entry-2"],
			artifactShas: ["a".repeat(64)],
			note: "note",
		});
		await repo.upsertStepPayload({
			runId: RUN_ID,
			stepName: "run_command",
			attempt: 1,
			payload: { command: "prompt", seq: 1 },
		});

		expect(pool.calls[1]?.sql.toLowerCase()).toContain("session_entry_ids");
		expect(pool.calls[1]?.sql.toLowerCase()).toContain("artifact_shas");
		expect(pool.calls[1]?.params?.[3]).toEqual(["entry-1", "entry-2"]);
		expect(pool.calls[1]?.params?.[4]).toEqual(["a".repeat(64)]);
		expect(pool.calls[2]?.sql.toLowerCase()).toContain("payload");
		expect(pool.calls[2]?.params?.[3]).toBe(
			JSON.stringify({ command: "prompt", seq: 1 }),
		);
	});

	it("assembles truth bundle from run + ledger tables", async () => {
		const pool = new StubPool([
			{ rows: [runRow()], rowCount: 1 },
			{ rows: [stepRow()], rowCount: 1 },
			{ rows: [linkRow()], rowCount: 1 },
			{
				rows: [
					{
						run_id: RUN_ID,
						sha256: "b".repeat(64),
						kind: "pi_session_jsonl",
						created_at: ISO,
					},
				],
				rowCount: 1,
			},
			{ rows: [stepPayloadRow()], rowCount: 1 },
			{
				rows: [
					{
						run_id: RUN_ID,
						entry_count: 8,
						root_id: "root",
						leaf_id: "leaf",
						summary_entry_count: 1,
						updated_at: ISO,
					},
				],
				rowCount: 1,
			},
		]);
		const repo = new PgRunRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const truth = await repo.getTruthBundle(RUN_ID);

		expect(truth?.run.runId).toBe(RUN_ID);
		expect(truth?.steps).toHaveLength(1);
		expect(truth?.links).toHaveLength(1);
		expect(truth?.artifacts).toHaveLength(1);
		expect(truth?.stepPayloads).toHaveLength(1);
		expect(truth?.sessionIndex?.entryCount).toBe(8);
	});
});
