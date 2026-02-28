import { describe, expect, it } from "vitest";
import { PgActorRepo } from "../../apps/api/src/actor";

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

const ISO = "2026-02-28T00:00:00.000Z";

function actorRow(overrides: Record<string, unknown> = {}) {
	return {
		actor_id: "actor-1",
		name: "worker",
		status: "idle",
		mailbox_cursor: 0,
		next_mailbox_seq: 1,
		inflight_workflow_id: null,
		pi_session_id: null,
		pi_session_file: null,
		mem_ref: null,
		workspace_id: null,
		updated_at: ISO,
		...overrides,
	};
}

function mailboxRow(overrides: Record<string, unknown> = {}) {
	return {
		msg_id: 3,
		actor_id: "actor-1",
		seq: 3,
		kind: "prompt",
		payload: { text: "hello", attachments: [], metadata: {} },
		dedupe_key: "msg-1",
		state: "queued",
		claimed_by: null,
		claimed_at: null,
		claim_lease_ms: 60000,
		done_at: null,
		error: null,
		created_at: ISO,
		...overrides,
	};
}

describe("PgActorRepo", () => {
	it("posts mailbox messages transactionally with SQL seq allocation", async () => {
		const pool = new StubPool([
			{},
			{ rows: [actorRow()], rowCount: 1 },
			{ rows: [], rowCount: 0 },
			{ rows: [{ seq: 3 }], rowCount: 1 },
			{ rows: [mailboxRow()], rowCount: 1 },
			{
				rows: [
					{
						seq: 7,
						actor_id: "actor-1",
						kind: "mailbox_queued",
						payload: { seq: 3 },
						created_at: ISO,
					},
				],
				rowCount: 1,
			},
			{ rows: [{ seq: 3 }], rowCount: 1 },
			{},
		]);
		const repo = new PgActorRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const result = await repo.postMailboxMessage({
			actorId: "actor-1",
			kind: "prompt",
			text: "hello",
			attachments: [],
			dedupeKey: "msg-1",
		});

		expect(result.message.seq).toBe(3);
		expect(result.firstPendingSeq).toBe(3);
		expect(result.event.kind).toBe("mailbox_queued");
		expect(pool.calls.map((call) => call.sql.toLowerCase())).toEqual([
			"begin",
			expect.stringContaining("for update"),
			expect.stringContaining("where actor_id = $1 and dedupe_key = $2"),
			expect.stringContaining("update actor"),
			expect.stringContaining("insert into mailbox_msg"),
			expect.stringContaining("insert into actor_event"),
			expect.stringContaining("select min(seq) as seq"),
			"commit",
		]);
	});

	it("reuses the original mailbox_queued event on dedupe hits", async () => {
		const pool = new StubPool([
			{},
			{ rows: [actorRow()], rowCount: 1 },
			{ rows: [mailboxRow()], rowCount: 1 },
			{
				rows: [
					{
						seq: 7,
						actor_id: "actor-1",
						kind: "mailbox_queued",
						payload: { msgId: 3, seq: 3, kind: "prompt" },
						created_at: ISO,
					},
				],
				rowCount: 1,
			},
			{ rows: [{ seq: 3 }], rowCount: 1 },
			{},
		]);
		const repo = new PgActorRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const result = await repo.postMailboxMessage({
			actorId: "actor-1",
			kind: "prompt",
			text: "hello",
			attachments: [],
			dedupeKey: "msg-1",
		});

		expect(result.event.eventId).toBe(7);
		expect(pool.calls[3]?.sql.toLowerCase()).toContain("from actor_event");
		expect(pool.calls[3]?.sql.toLowerCase()).not.toContain(
			"insert into actor_event",
		);
	});

	it("acquires actor lease with expiry-aware upsert and inflight marker", async () => {
		const pool = new StubPool([
			{},
			{ rows: [{ actor_id: "actor-1" }], rowCount: 1 },
			{},
			{},
		]);
		const repo = new PgActorRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const acquired = await repo.acquireTickLease({
			actorId: "actor-1",
			workflowId: "tick:actor-1:3",
			leaseMs: 60_000,
		});

		expect(acquired).toBe(true);
		expect(pool.calls[1]?.sql.toLowerCase()).toContain(
			"insert into actor_lock",
		);
		expect(pool.calls[1]?.sql.toLowerCase()).toContain(
			"interval '1 millisecond'",
		);
		expect(pool.calls[2]?.sql.toLowerCase()).toContain(
			"update actor\n\t\t\t\t set inflight_workflow_id",
		);
	});

	it("marks done rows and returns the next pending seq", async () => {
		const pool = new StubPool([
			{},
			{
				rows: [
					{
						seq: 7,
						actor_id: "actor-1",
						kind: "mailbox_processed",
						payload: { seq: 5 },
						created_at: ISO,
					},
				],
				rowCount: 1,
			},
			{},
			{ rows: [actorRow({ mailbox_cursor: 5 })], rowCount: 1 },
			{ rows: [{ seq: 6 }], rowCount: 1 },
			{},
		]);
		const repo = new PgActorRepo({
			databaseUrl: "postgres://unused",
			pool,
		});

		const result = await repo.persistProcessedBatch({
			actorId: "actor-1",
			workflowId: "tick:actor-1:5",
			seqs: [5],
			actorStatus: "idle",
			events: [{ kind: "mailbox_processed", payload: { seq: 5 } }],
		});

		expect(result.mailboxCursor).toBe(5);
		expect(result.remainingPendingSeq).toBe(6);
		expect(pool.calls.map((call) => call.sql.toLowerCase())).toEqual([
			"begin",
			expect.stringContaining("insert into actor_event"),
			expect.stringContaining("update mailbox_msg"),
			expect.stringContaining("greatest(mailbox_cursor, $2)"),
			expect.stringContaining("select min(seq) as seq"),
			"commit",
		]);
	});
});
