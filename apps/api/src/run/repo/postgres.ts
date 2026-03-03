import pg from "pg";
import { getTenantScope, withScopeTx } from "../../http/scope";
import { createPoolCloseOnce } from "../../repo/pool-close";
import type {
	AppendRunEventInput,
	CreateRunInput,
	CreateStepInput,
	LinkModel,
	RecordStepLedgerInput,
	RunArtifactLinkModel,
	RunEventModel,
	RunModel,
	RunRepo,
	RunSpecModel,
	SessionIndexModel,
	StepModel,
	StepPayloadModel,
	TruthBundle,
	UpsertLinkInput,
	UpsertSessionIndexInput,
	UpsertStepPayloadInput,
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

type RunArtifactRow = PgRowBase & {
	run_id: string;
	sha256: string;
	kind: string;
};

type StepRow = {
	run_id: string;
	step_name: string;
	attempt: number;
	step_key: string;
	in_hash: string;
	out_hash: string | null;
	started_at: Date | string;
	ended_at: Date | string | null;
};

type LinkRow = PgRowBase & {
	run_id: string;
	step_name: string;
	attempt: number;
	session_entry_ids: string[] | null;
	artifact_shas: string[] | null;
	note: string | null;
};

type SessionIndexRow = {
	run_id: string;
	entry_count: number;
	root_id: string | null;
	leaf_id: string | null;
	summary_entry_count: number;
	updated_at: Date | string;
};

type StepPayloadRow = PgRowBase & {
	run_id: string;
	step_name: string;
	attempt: number;
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

function requireSingleRow<TRow>(
	result: QueryResultLike<TRow>,
	errPrefix: string,
): TRow {
	if (result.rowCount !== 1) {
		throw new Error(
			`${errPrefix}: expected 1 row, got ${String(result.rowCount)}`,
		);
	}
	return requireRow(result, errPrefix);
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
		resultStats: row.result_stats,
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

function toRunArtifactLinkModel(row: RunArtifactRow): RunArtifactLinkModel {
	return {
		runId: row.run_id,
		sha256: row.sha256,
		kind: row.kind,
		createdAt: asIsoString(row.created_at),
	};
}

function toStepModel(row: StepRow): StepModel {
	return {
		runId: row.run_id,
		stepName: row.step_name,
		attempt: row.attempt,
		stepKey: row.step_key,
		inHash: row.in_hash,
		outHash: row.out_hash,
		startedAt: asIsoString(row.started_at),
		endedAt: row.ended_at ? asIsoString(row.ended_at) : null,
	};
}

function toLinkModel(row: LinkRow): LinkModel {
	return {
		runId: row.run_id,
		stepName: row.step_name,
		attempt: row.attempt,
		sessionEntryIds: row.session_entry_ids ?? [],
		artifactShas: row.artifact_shas ?? [],
		note: row.note,
		createdAt: asIsoString(row.created_at),
	};
}

function toSessionIndexModel(row: SessionIndexRow): SessionIndexModel {
	return {
		runId: row.run_id,
		entryCount: row.entry_count,
		rootId: row.root_id,
		leafId: row.leaf_id,
		summaryEntryCount: row.summary_entry_count,
		updatedAt: asIsoString(row.updated_at),
	};
}

function toStepPayloadModel(row: StepPayloadRow): StepPayloadModel {
	return {
		runId: row.run_id,
		stepName: row.step_name,
		attempt: row.attempt,
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
	private readonly closePool: () => Promise<void>;

	constructor(deps: PgRunRepoDeps) {
		this.pool =
			deps.pool ?? new pg.Pool({ connectionString: deps.databaseUrl });
		this.closePool = createPoolCloseOnce(this.pool);
	}

	async close(): Promise<void> {
		await this.closePool();
	}

	private async withTenantScope<T>(
		fn: (queryable: Queryable) => Promise<T>,
	): Promise<T> {
		const scope = getTenantScope();
		if (!scope) {
			return fn(this.pool);
		}
		const client = await this.pool.connect();
		try {
			return await withScopeTx(client, scope, () => fn(client));
		} finally {
			client.release();
		}
	}

	private async withClientTx<T>(
		fn: (client: PoolClientLike) => Promise<T>,
	): Promise<T> {
		const scope = getTenantScope();
		const client = await this.pool.connect();
		try {
			if (scope) {
				return await withScopeTx(client, scope, () => fn(client));
			}
			await client.query("begin");
			try {
				const output = await fn(client);
				await client.query("commit");
				return output;
			} catch (error) {
				await client.query("rollback");
				throw error;
			}
		} finally {
			client.release();
		}
	}

	async createRun(
		input: CreateRunInput,
	): Promise<{ run: RunModel; created: boolean }> {
		return this.withClientTx(async (client) => {
			const inserted = await client.query<RunRow>(
				`insert into runs(
					 run_id, status, spec, dbos_workflow_id, org_id, ws_id, member_id
				 )
					 values ($1, 'queued', $2::jsonb, null, $3::uuid, $4::uuid, $5::uuid)
					 on conflict (run_id) do nothing
					 returning run_id, status, spec, created_at, updated_at, dbos_workflow_id,
					 pi_session_id, pi_session_file, result_text, result_stats, error`,
				[
					input.runId,
					JSON.stringify(input.spec),
					input.spec.orgId,
					input.spec.wsId ?? null,
					input.spec.memberId ?? null,
				],
			);

			if (inserted.rowCount && inserted.rowCount > 0) {
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
			return {
				run: toRunModel(requireRow(existing, "create run select existing")),
				created: false,
			};
		});
	}

	async recordWorkflowLaunch(
		runId: string,
		workflowId: string,
	): Promise<RunModel | null> {
		return this.withTenantScope(async (queryable) => {
			const result = await queryable.query<RunRow>(
				`update runs
					 set dbos_workflow_id = coalesce(dbos_workflow_id, $2),
						 updated_at = now()
					 where run_id = $1
					 returning run_id, status, spec, created_at, updated_at, dbos_workflow_id,
					 pi_session_id, pi_session_file, result_text, result_stats, error`,
				[runId, workflowId],
			);
			if (!result.rowCount) {
				return null;
			}
			return toRunModel(requireRow(result, "record workflow launch"));
		});
	}

	async beginRun(input: {
		runId: string;
		workflowId: string;
		payload: Record<string, unknown>;
	}): Promise<RunEventModel> {
		return this.withClientTx(async (client) => {
			const runResult = await client.query<RunRow>(
				`update runs
					 set status = 'running',
						 dbos_workflow_id = coalesce(dbos_workflow_id, $2),
						 updated_at = now()
					 where run_id = $1
					 returning run_id, status, spec, created_at, updated_at, dbos_workflow_id,
					 pi_session_id, pi_session_file, result_text, result_stats, error`,
				[input.runId, input.workflowId],
			);
			if (!runResult.rowCount) {
				throw new Error(`begin run: missing run ${input.runId}`);
			}
			const eventResult = await client.query<RunEventRow>(
				`insert into events(run_id, kind, payload)
				 values ($1, 'run_started', $2::jsonb)
				 returning event_id, run_id, kind, payload, created_at`,
				[input.runId, JSON.stringify(input.payload)],
			);
			return toRunEventModel(requireRow(eventResult, "begin run event"));
		});
	}

	async getRun(runId: string): Promise<RunModel | null> {
		return this.withTenantScope(async (queryable) => {
			const result = await queryable.query<RunRow>(
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
		});
	}

	async appendEvent(input: AppendRunEventInput): Promise<RunEventModel> {
		return this.withTenantScope(async (queryable) => {
			const result = await queryable.query<RunEventRow>(
				`insert into events(run_id, kind, payload)
				 values ($1, $2, $3::jsonb)
				 returning event_id, run_id, kind, payload, created_at`,
				[input.runId, input.kind, JSON.stringify(input.payload)],
			);
			return toRunEventModel(requireRow(result, "append event"));
		});
	}

	async listEventsSince(
		runId: string,
		sinceEventId: number,
		limit: number,
	): Promise<RunEventModel[]> {
		const safeLimit = clampLimit(limit);
		return this.withTenantScope(async (queryable) => {
			const result = await queryable.query<RunEventRow>(
				`select event_id, run_id, kind, payload, created_at
				 from events
				 where run_id = $1 and event_id > $2
				 order by event_id asc
				 limit $3`,
				[runId, sinceEventId, safeLimit],
			);
			return result.rows.map(toRunEventModel);
		});
	}

	async listArtifacts(runId: string): Promise<RunArtifactLinkModel[]> {
		return this.withTenantScope(async (queryable) => {
			const result = await queryable.query<RunArtifactRow>(
				`select run_id, sha256, kind, created_at
				 from run_artifacts
				 where run_id = $1
				 order by created_at asc, sha256 asc, kind asc`,
				[runId],
			);
			return result.rows.map(toRunArtifactLinkModel);
		});
	}

	async createStep(input: CreateStepInput): Promise<StepModel> {
		return this.withTenantScope((queryable) =>
			this.createStepFrom(queryable, input),
		);
	}

	async upsertLink(input: UpsertLinkInput): Promise<LinkModel> {
		return this.withTenantScope((queryable) =>
			this.upsertLinkFrom(queryable, input),
		);
	}

	async upsertSessionIndex(
		input: UpsertSessionIndexInput,
	): Promise<SessionIndexModel> {
		return this.withTenantScope((queryable) =>
			this.upsertSessionIndexFrom(queryable, input),
		);
	}

	async upsertStepPayload(
		input: UpsertStepPayloadInput,
	): Promise<StepPayloadModel> {
		return this.withTenantScope((queryable) =>
			this.upsertStepPayloadFrom(queryable, input),
		);
	}

	async recordStepLedger(input: RecordStepLedgerInput): Promise<void> {
		await this.withClientTx(async (client) => {
			await this.createStepFrom(client, {
				runId: input.runId,
				stepName: input.stepName,
				attempt: input.attempt,
				stepKey: input.stepKey,
				inHash: input.inHash,
				outHash: input.outHash,
				startedAt: input.startedAt,
				endedAt: input.endedAt,
			});
			if (input.payload) {
				await this.upsertStepPayloadFrom(client, {
					runId: input.runId,
					stepName: input.stepName,
					attempt: input.attempt,
					payload: input.payload,
				});
			}
			await this.upsertLinkFrom(client, {
				runId: input.runId,
				stepName: input.stepName,
				attempt: input.attempt,
				sessionEntryIds: input.sessionEntryIds,
				artifactShas: input.artifactShas,
				note: input.note,
			});
			if (input.sessionIndex) {
				await this.upsertSessionIndexFrom(client, {
					runId: input.runId,
					entryCount: input.sessionIndex.entryCount,
					rootId: input.sessionIndex.rootId,
					leafId: input.sessionIndex.leafId,
					summaryEntryCount: input.sessionIndex.summaryEntryCount ?? 0,
				});
			}
		});
	}

	private async createStepFrom(
		queryable: Queryable,
		input: CreateStepInput,
	): Promise<StepModel> {
		const result = await queryable.query<StepRow>(
			`insert into steps(
				 run_id, step_name, attempt, step_key, in_hash, out_hash, started_at, ended_at
			 )
			 values (
				 $1, $2, $3, $4, $5, $6, coalesce($7::timestamptz, now()), $8::timestamptz
			 )
			 on conflict (run_id, step_name, attempt) do update
			 set step_key = excluded.step_key,
				 in_hash = excluded.in_hash,
				 out_hash = coalesce(excluded.out_hash, steps.out_hash),
				 started_at = least(steps.started_at, excluded.started_at),
				 ended_at = coalesce(excluded.ended_at, steps.ended_at)
			 returning run_id, step_name, attempt, step_key, in_hash, out_hash,
			 started_at, ended_at`,
			[
				input.runId,
				input.stepName,
				input.attempt,
				input.stepKey,
				input.inHash,
				input.outHash ?? null,
				input.startedAt ?? null,
				input.endedAt ?? null,
			],
		);
		return toStepModel(requireSingleRow(result, "create step"));
	}

	private async upsertLinkFrom(
		queryable: Queryable,
		input: UpsertLinkInput,
	): Promise<LinkModel> {
		const result = await queryable.query<LinkRow>(
			`insert into links(
				 run_id, step_name, attempt, session_entry_ids, artifact_shas, note
			 )
			 values ($1, $2, $3, $4::text[], $5::text[], $6)
			 on conflict (run_id, step_name, attempt) do update
			 set session_entry_ids = excluded.session_entry_ids,
				 artifact_shas = excluded.artifact_shas,
				 note = coalesce(excluded.note, links.note),
				 created_at = links.created_at
			 returning run_id, step_name, attempt, session_entry_ids, artifact_shas,
			 note, created_at`,
			[
				input.runId,
				input.stepName,
				input.attempt,
				input.sessionEntryIds,
				input.artifactShas,
				input.note ?? null,
			],
		);
		return toLinkModel(requireSingleRow(result, "upsert link"));
	}

	private async upsertSessionIndexFrom(
		queryable: Queryable,
		input: UpsertSessionIndexInput,
	): Promise<SessionIndexModel> {
		const result = await queryable.query<SessionIndexRow>(
			`insert into sessions_index(
				 run_id, entry_count, root_id, leaf_id, summary_entry_count
			 )
			 values ($1, $2, $3, $4, $5)
			 on conflict (run_id) do update
			 set entry_count = excluded.entry_count,
				 root_id = coalesce(excluded.root_id, sessions_index.root_id),
				 leaf_id = coalesce(excluded.leaf_id, sessions_index.leaf_id),
				 summary_entry_count = excluded.summary_entry_count,
				 updated_at = now()
			 returning run_id, entry_count, root_id, leaf_id, summary_entry_count,
			 updated_at`,
			[
				input.runId,
				input.entryCount,
				input.rootId ?? null,
				input.leafId ?? null,
				input.summaryEntryCount ?? 0,
			],
		);
		return toSessionIndexModel(
			requireSingleRow(result, "upsert session index"),
		);
	}

	private async upsertStepPayloadFrom(
		queryable: Queryable,
		input: UpsertStepPayloadInput,
	): Promise<StepPayloadModel> {
		const result = await queryable.query<StepPayloadRow>(
			`insert into step_payloads(run_id, step_name, attempt, payload)
			 values ($1, $2, $3, $4::jsonb)
			 on conflict (run_id, step_name, attempt) do update
			 set payload = excluded.payload
			 returning run_id, step_name, attempt, payload, created_at`,
			[
				input.runId,
				input.stepName,
				input.attempt,
				JSON.stringify(input.payload),
			],
		);
		return toStepPayloadModel(requireSingleRow(result, "upsert step payload"));
	}

	async listSteps(runId: string): Promise<StepModel[]> {
		return this.withTenantScope(async (queryable) => {
			const result = await queryable.query<StepRow>(
				`select run_id, step_name, attempt, step_key, in_hash, out_hash,
				 started_at, ended_at
				 from steps
				 where run_id = $1
				 order by started_at asc, step_name asc, attempt asc`,
				[runId],
			);
			return result.rows.map(toStepModel);
		});
	}

	async listLinks(runId: string): Promise<LinkModel[]> {
		return this.withTenantScope(async (queryable) => {
			const result = await queryable.query<LinkRow>(
				`select run_id, step_name, attempt, session_entry_ids, artifact_shas,
				 note, created_at
				 from links
				 where run_id = $1
				 order by created_at asc, step_name asc, attempt asc`,
				[runId],
			);
			return result.rows.map(toLinkModel);
		});
	}

	async listStepPayloads(runId: string): Promise<StepPayloadModel[]> {
		return this.withTenantScope(async (queryable) => {
			const result = await queryable.query<StepPayloadRow>(
				`select run_id, step_name, attempt, payload, created_at
				 from step_payloads
				 where run_id = $1
				 order by created_at asc, step_name asc, attempt asc`,
				[runId],
			);
			return result.rows.map(toStepPayloadModel);
		});
	}

	async getTruthBundle(runId: string): Promise<TruthBundle | null> {
		return this.withTenantScope(async (queryable) => {
			const runResult = await queryable.query<RunRow>(
				`select run_id, status, spec, created_at, updated_at, dbos_workflow_id,
				 pi_session_id, pi_session_file, result_text, result_stats, error
				 from runs
				 where run_id = $1`,
				[runId],
			);
			if (!runResult.rowCount) {
				return null;
			}
			const run = toRunModel(requireRow(runResult, "get truth bundle run"));
			const stepsResult = await queryable.query<StepRow>(
				`select run_id, step_name, attempt, step_key, in_hash, out_hash,
				 started_at, ended_at
				 from steps
				 where run_id = $1
				 order by started_at asc, step_name asc, attempt asc`,
				[runId],
			);
			const linksResult = await queryable.query<LinkRow>(
				`select run_id, step_name, attempt, session_entry_ids, artifact_shas,
				 note, created_at
				 from links
				 where run_id = $1
				 order by created_at asc, step_name asc, attempt asc`,
				[runId],
			);
			const artifactsResult = await queryable.query<RunArtifactRow>(
				`select run_id, sha256, kind, created_at
				 from run_artifacts
				 where run_id = $1
				 order by created_at asc, sha256 asc, kind asc`,
				[runId],
			);
			const payloadsResult = await queryable.query<StepPayloadRow>(
				`select run_id, step_name, attempt, payload, created_at
				 from step_payloads
				 where run_id = $1
				 order by created_at asc, step_name asc, attempt asc`,
				[runId],
			);
			const sessionIndexResult = await queryable.query<SessionIndexRow>(
				`select run_id, entry_count, root_id, leaf_id, summary_entry_count,
				 updated_at
				 from sessions_index
				 where run_id = $1`,
				[runId],
			);
			return {
				run,
				steps: stepsResult.rows.map(toStepModel),
				links: linksResult.rows.map(toLinkModel),
				artifacts: artifactsResult.rows.map(toRunArtifactLinkModel),
				sessionIndex: sessionIndexResult.rowCount
					? toSessionIndexModel(
							requireRow(sessionIndexResult, "get truth bundle session index"),
						)
					: null,
				stepPayloads: payloadsResult.rows.map(toStepPayloadModel),
			};
		});
	}

	async completeRun(input: {
		runId: string;
		resultText: string;
		resultStats: Record<string, unknown>;
		eventPayload: Record<string, unknown>;
		piSessionId?: string | undefined;
		piSessionFile?: string | undefined;
	}): Promise<{ run: RunModel | null; event: RunEventModel | null }> {
		return this.withClientTx(async (client) => {
			const runResult = await client.query<RunRow>(
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
			if (!runResult.rowCount) {
				return { run: null, event: null };
			}
			const eventResult = await client.query<RunEventRow>(
				`insert into events(run_id, kind, payload)
				 values ($1, 'run_done', $2::jsonb)
				 returning event_id, run_id, kind, payload, created_at`,
				[input.runId, JSON.stringify(input.eventPayload)],
			);
			return {
				run: toRunModel(requireRow(runResult, "complete run")),
				event: toRunEventModel(requireRow(eventResult, "complete run event")),
			};
		});
	}

	async failRun(input: {
		runId: string;
		error: string;
		eventPayload: Record<string, unknown>;
	}): Promise<{ run: RunModel | null; event: RunEventModel | null }> {
		return this.withClientTx(async (client) => {
			const runResult = await client.query<RunRow>(
				`update runs
					 set status = 'failed',
						 error = $2,
						 updated_at = now()
					 where run_id = $1
					 returning run_id, status, spec, created_at, updated_at, dbos_workflow_id,
					 pi_session_id, pi_session_file, result_text, result_stats, error`,
				[input.runId, input.error],
			);
			if (!runResult.rowCount) {
				return { run: null, event: null };
			}
			const eventResult = await client.query<RunEventRow>(
				`insert into events(run_id, kind, payload)
				 values ($1, 'run_failed', $2::jsonb)
				 returning event_id, run_id, kind, payload, created_at`,
				[input.runId, JSON.stringify(input.eventPayload)],
			);
			return {
				run: toRunModel(requireRow(runResult, "fail run")),
				event: toRunEventModel(requireRow(eventResult, "fail run event")),
			};
		});
	}

	async linkArtifact(input: {
		runId: string;
		sha256: string;
		kind: string;
	}): Promise<void> {
		await this.withTenantScope(async (queryable) => {
			await queryable.query(
				`insert into run_artifacts(run_id, sha256, kind)
				 values ($1, $2, $3)
				 on conflict (run_id, sha256, kind) do nothing`,
				[input.runId, input.sha256, input.kind],
			);
		});
	}
}
