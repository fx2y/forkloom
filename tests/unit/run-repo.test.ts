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
		status: "running",
		spec: {
			runId: RUN_ID,
			scope: "team" as RunScope,
			userMsg: "hello",
			attachments: [],
		},
		created_at: ISO,
		updated_at: ISO,
		dbos_workflow_id: RUN_ID,
		pi_session_id: null,
		pi_session_file: null,
		result_text: null,
		result_stats: {},
		error: null,
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
			workflowId: RUN_ID,
			spec: {
				runId: RUN_ID,
				scope: "team",
				userMsg: "hello",
				attachments: [],
			},
		});

		expect(out.created).toBe(true);
		expect(out.run.dbosWorkflowId).toBe(RUN_ID);
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
			workflowId: RUN_ID,
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
});
