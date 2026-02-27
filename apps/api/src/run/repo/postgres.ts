import pg from "pg";
import type {
	AppendRunEventInput,
	CreateRunInput,
	RunEventModel,
	RunModel,
	RunRepo,
	RunSpecModel,
} from "../ports";

type PgRowBase = {
	created_at: Date | string;
};

type RunRow = PgRowBase & {
	run_id: string;
	status: RunModel["status"];
	spec: RunSpecModel;
	updated_at: Date | string;
	dbos_workflow_id: string | null;
	pi_session_id: string | null;
	pi_session_file: string | null;
	result_text: string | null;
	result_stats: Record<string, unknown> | null;
	error: string | null;
};

type RunEventRow = PgRowBase & {
	event_id: string | number;
	run_id: string;
	kind: RunEventModel["kind"];
	payload: Record<string, unknown> | null;
};

type QueryResultLike<TRow> = {
	rows: TRow[];
	rowCount: number | null;
};

type Queryable = {
	query<TRow = unknown>(
		text: string,
		values?: readonly unknown[],
	): Promise<QueryResultLike<TRow>>;
};

type PoolClientLike = Queryable & { release(): void };

type PoolLike = Queryable & {
	connect(): Promise<PoolClientLike>;
	end(): Promise<void>;
};

export type PgRunRepoDeps = {
	databaseUrl: string;
	pool?: PoolLike | undefined;
};

function asIsoString(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}

function requireRow<TRow>(
	result: QueryResultLike<TRow>,
	errPrefix: string,
): TRow {
	const row = result.rows[0];
	if (!row) {
		throw new Error(`${errPrefix}: missing row`);
	}
	return row;
}

function toRunModel(row: RunRow): RunModel {
	return {
		runId: row.run_id,
		status: row.status,
		spec: row.spec,
		createdAt: asIsoString(row.created_at),
		updatedAt: asIsoString(row.updated_at),
		dbosWorkflowId: row.dbos_workflow_id,
		piSessionId: row.pi_session_id,
		piSessionFile: row.pi_session_file,
		resultText: row.result_text,
		resultStats: row.result_stats ?? {},
		error: row.error,
	};
}

function toRunEventModel(row: RunEventRow): RunEventModel {
	return {
		eventId: Number(row.event_id),
		runId: row.run_id,
		kind: row.kind,
		payload: row.payload ?? {},
		createdAt: asIsoString(row.created_at),
	};
}

function clampLimit(limit: number): number {
	if (!Number.isFinite(limit)) {
		return 100;
	}
	return Math.max(1, Math.min(1_000, Math.trunc(limit)));
}

export class PgRunRepo implements RunRepo {
	private readonly pool: PoolLike;

	constructor(deps: PgRunRepoDeps) {
		this.pool =
			deps.pool ?? new pg.Pool({ connectionString: deps.databaseUrl });
	}

	async close(): Promise<void> {
		await this.pool.end();
	}

	async createRun(
		input: CreateRunInput,
	): Promise<{ run: RunModel; created: boolean }> {
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			const inserted = await client.query<RunRow>(
				`insert into runs(run_id, status, spec, dbos_workflow_id)
				 values ($1, 'running', $2::jsonb, $3)
				 on conflict (run_id) do nothing
				 returning run_id, status, spec, created_at, updated_at, dbos_workflow_id,
				 pi_session_id, pi_session_file, result_text, result_stats, error`,
				[input.runId, JSON.stringify(input.spec), input.workflowId],
			);

			if (inserted.rowCount && inserted.rowCount > 0) {
				await client.query("commit");
				return {
					run: toRunModel(requireRow(inserted, "create run insert")),
					created: true,
				};
			}

			const existing = await client.query<RunRow>(
				`select run_id, status, spec, created_at, updated_at, dbos_workflow_id,
					 pi_session_id, pi_session_file, result_text, result_stats, error
					 from runs
					 where run_id = $1`,
				[input.runId],
			);
			await client.query("commit");
			return {
				run: toRunModel(requireRow(existing, "create run select existing")),
				created: false,
			};
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	async getRun(runId: string): Promise<RunModel | null> {
		const result = await this.pool.query<RunRow>(
			`select run_id, status, spec, created_at, updated_at, dbos_workflow_id,
			 pi_session_id, pi_session_file, result_text, result_stats, error
			 from runs
			 where run_id = $1`,
			[runId],
		);
		if (!result.rowCount) {
			return null;
		}
		return toRunModel(requireRow(result, "get run"));
	}

	async appendEvent(input: AppendRunEventInput): Promise<RunEventModel> {
		const result = await this.pool.query<RunEventRow>(
			`insert into events(run_id, kind, payload)
			 values ($1, $2, $3::jsonb)
			 returning event_id, run_id, kind, payload, created_at`,
			[input.runId, input.kind, JSON.stringify(input.payload)],
		);
		return toRunEventModel(requireRow(result, "append event"));
	}

	async listEventsSince(
		runId: string,
		sinceEventId: number,
		limit: number,
	): Promise<RunEventModel[]> {
		const safeLimit = clampLimit(limit);
		const result = await this.pool.query<RunEventRow>(
			`select event_id, run_id, kind, payload, created_at
			 from events
			 where run_id = $1 and event_id > $2
			 order by event_id asc
			 limit $3`,
			[runId, sinceEventId, safeLimit],
		);
		return result.rows.map(toRunEventModel);
	}

	async markDone(input: {
		runId: string;
		resultText: string;
		resultStats: Record<string, unknown>;
		piSessionId?: string | undefined;
		piSessionFile?: string | undefined;
	}): Promise<RunModel | null> {
		const result = await this.pool.query<RunRow>(
			`update runs
				 set status = 'done',
					 result_text = $2,
					 result_stats = $3::jsonb,
					 pi_session_id = coalesce($4, pi_session_id),
					 pi_session_file = coalesce($5, pi_session_file),
					 updated_at = now()
				 where run_id = $1
				 returning run_id, status, spec, created_at, updated_at, dbos_workflow_id,
				 pi_session_id, pi_session_file, result_text, result_stats, error`,
			[
				input.runId,
				input.resultText,
				JSON.stringify(input.resultStats),
				input.piSessionId ?? null,
				input.piSessionFile ?? null,
			],
		);
		if (!result.rowCount) {
			return null;
		}
		return toRunModel(requireRow(result, "mark done"));
	}

	async markFailed(runId: string, error: string): Promise<RunModel | null> {
		const result = await this.pool.query<RunRow>(
			`update runs
				 set status = 'failed',
					 error = $2,
					 updated_at = now()
				 where run_id = $1
				 returning run_id, status, spec, created_at, updated_at, dbos_workflow_id,
				 pi_session_id, pi_session_file, result_text, result_stats, error`,
			[runId, error],
		);
		if (!result.rowCount) {
			return null;
		}
		return toRunModel(requireRow(result, "mark failed"));
	}

	async linkArtifact(input: {
		runId: string;
		sha256: string;
		kind: string;
	}): Promise<void> {
		await this.pool.query(
			`insert into run_artifacts(run_id, sha256, kind)
			 values ($1, $2, $3)
			 on conflict (run_id, sha256, kind) do nothing`,
			[input.runId, input.sha256, input.kind],
		);
	}
}
