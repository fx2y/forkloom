import pg from "pg";
import { createPoolCloseOnce } from "../../repo/pool-close";
import { needsSandboxApproval } from "../profile";
import type {
	ExecResult,
	RunCommandKind,
	RunCommandModel,
	SandboxExecModel,
	SandboxModel,
	SandboxPreviewModel,
	SandboxRepo,
	SandboxSpecModel,
	SandboxState,
} from "../ports";

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

type SandboxRow = {
	run_id: string;
	sandbox_id: string;
	backend: SandboxModel["backend"];
	profile: SandboxModel["profile"];
	state: SandboxModel["state"];
	approval_state: SandboxModel["approvalState"];
	spec: SandboxSpecModel;
	preview_spec: SandboxPreviewModel;
	container_name: string;
	work_volume: string;
	inflight_workflow_id: string | null;
	lease_expires_at: Date | string | null;
	workspace_ref: string | null;
	created_at: Date | string;
	updated_at: Date | string;
	last_seen_at: Date | string;
};

type RunCommandRow = {
	run_id: string;
	seq: string | number;
	kind: RunCommandModel["kind"];
	payload: Record<string, unknown> | null;
	dedupe_key: string | null;
	state: RunCommandModel["state"];
	claimed_by: string | null;
	claimed_at: Date | string | null;
	lease_expires_at: Date | string | null;
	done_at: Date | string | null;
	error: string | null;
	created_at: Date | string;
};

type SandboxExecRow = {
	exec_id: string | number;
	run_id: string;
	command_seq: string | number;
	command_kind: SandboxExecModel["commandKind"];
	status: SandboxExecModel["status"];
	exit_code: number | null;
	stdout_tail: string | null;
	stderr_tail: string | null;
	stdout_bytes: string | number;
	stderr_bytes: string | number;
	timeout_sec: number;
	max_bytes_out: number;
	stdout_ref: string | null;
	stderr_ref: string | null;
	workspace_ref: string | null;
	started_at: Date | string;
	ended_at: Date | string | null;
};

type PendingSeqRow = {
	seq: string | number | null;
};

export type PgSandboxRepoDeps = {
	databaseUrl: string;
	pool?: PoolLike | undefined;
};

function asIsoString(value: Date | string | null): string | null {
	if (value == null) {
		return null;
	}
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

function asArtifactPointer(sha256: string | null) {
	return typeof sha256 === "string" ? { sha256 } : undefined;
}

function toSandboxModel(row: SandboxRow): SandboxModel {
	return {
		runId: row.run_id,
		sandboxId: row.sandbox_id,
		backend: row.backend,
		profile: row.profile,
		state: row.state,
		approvalState: row.approval_state,
		spec: row.spec,
		previewSpec: row.preview_spec,
		containerName: row.container_name,
		workVolume: row.work_volume,
		inflightWorkflowId: row.inflight_workflow_id,
		leaseExpiresAt: asIsoString(row.lease_expires_at),
		workspaceRef: asArtifactPointer(row.workspace_ref),
		createdAt: asIsoString(row.created_at) ?? new Date(0).toISOString(),
		updatedAt: asIsoString(row.updated_at) ?? new Date(0).toISOString(),
		lastSeenAt: asIsoString(row.last_seen_at) ?? new Date(0).toISOString(),
	};
}

function toRunCommandModel(row: RunCommandRow): RunCommandModel {
	return {
		runId: row.run_id,
		seq: Number(row.seq),
		kind: row.kind,
		payload: row.payload ?? {},
		dedupeKey: row.dedupe_key,
		state: row.state,
		claimedBy: row.claimed_by,
		claimedAt: asIsoString(row.claimed_at),
		leaseExpiresAt: asIsoString(row.lease_expires_at),
		doneAt: asIsoString(row.done_at),
		error: row.error,
		createdAt: asIsoString(row.created_at) ?? new Date(0).toISOString(),
	};
}

function toSandboxExecModel(row: SandboxExecRow): SandboxExecModel {
	return {
		execId: Number(row.exec_id),
		runId: row.run_id,
		commandSeq: Number(row.command_seq),
		commandKind: row.command_kind,
		status: row.status,
		exitCode: row.exit_code,
		stdoutTail: row.stdout_tail ?? "",
		stderrTail: row.stderr_tail ?? "",
		stdoutBytes: Number(row.stdout_bytes),
		stderrBytes: Number(row.stderr_bytes),
		timeoutSec: row.timeout_sec,
		maxBytesOut: row.max_bytes_out,
		stdoutRef: asArtifactPointer(row.stdout_ref),
		stderrRef: asArtifactPointer(row.stderr_ref),
		workspaceRef: asArtifactPointer(row.workspace_ref),
		startedAt: asIsoString(row.started_at) ?? new Date(0).toISOString(),
		endedAt: asIsoString(row.ended_at),
	};
}

export class PgSandboxRepo implements SandboxRepo {
	private readonly pool: PoolLike;
	private readonly closePool: () => Promise<void>;

	constructor(deps: PgSandboxRepoDeps) {
		this.pool =
			deps.pool ?? new pg.Pool({ connectionString: deps.databaseUrl });
		this.closePool = createPoolCloseOnce(this.pool);
	}

	async close(): Promise<void> {
		await this.closePool();
	}

	async createSandbox(input: {
		runId: string;
		spec: SandboxSpecModel;
		previewSpec: SandboxPreviewModel;
	}): Promise<{ sandbox: SandboxModel; created: boolean }> {
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			const inserted = await client.query<SandboxRow>(
				`insert into sandbox(
					 run_id,
					 sandbox_id,
					 backend,
					 profile,
					 state,
					 approval_state,
					 spec,
					 preview_spec,
					 container_name,
					 work_volume
				 )
				 values ($1, $2, $3, $4, 'missing', $5, $6::jsonb, $7::jsonb, $8, $9)
				 on conflict (run_id) do nothing
				 returning run_id, sandbox_id, backend, profile, state, approval_state,
				 spec, preview_spec, container_name, work_volume, inflight_workflow_id,
				 lease_expires_at, workspace_ref, created_at, updated_at, last_seen_at`,
				[
					input.runId,
					input.spec.sandboxId,
					input.spec.backend,
					input.spec.profile,
					needsSandboxApproval(input.spec.profile) ? "pending" : "not_required",
					JSON.stringify(input.spec),
					JSON.stringify(input.previewSpec),
					input.spec.containerName,
					input.spec.workVolume,
				],
			);
			if (inserted.rowCount) {
				await client.query("commit");
				return {
					sandbox: toSandboxModel(requireRow(inserted, "create sandbox")),
					created: true,
				};
			}
			const existing = await client.query<SandboxRow>(
				`select run_id, sandbox_id, backend, profile, state, approval_state,
				 spec, preview_spec, container_name, work_volume, inflight_workflow_id,
				 lease_expires_at, workspace_ref, created_at, updated_at, last_seen_at
				 from sandbox
				 where run_id = $1`,
				[input.runId],
			);
			await client.query("commit");
			return {
				sandbox: toSandboxModel(
					requireRow(existing, "create sandbox select existing"),
				),
				created: false,
			};
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	async getSandbox(runId: string): Promise<SandboxModel | null> {
		const result = await this.pool.query<SandboxRow>(
			`select run_id, sandbox_id, backend, profile, state, approval_state,
			 spec, preview_spec, container_name, work_volume, inflight_workflow_id,
			 lease_expires_at, workspace_ref, created_at, updated_at, last_seen_at
			 from sandbox
			 where run_id = $1`,
			[runId],
		);
		if (!result.rowCount) {
			return null;
		}
		return toSandboxModel(requireRow(result, "get sandbox"));
	}

	async queueCommand(input: {
		runId: string;
		kind: RunCommandKind;
		payload: Record<string, unknown>;
		dedupeKey?: string | undefined;
	}): Promise<{
		command: RunCommandModel;
		created: boolean;
		firstPendingSeq: number | null;
	}> {
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			const sandboxResult = await client.query<SandboxRow>(
				`select run_id, sandbox_id, backend, profile, state, approval_state,
				 spec, preview_spec, container_name, work_volume, inflight_workflow_id,
				 lease_expires_at, workspace_ref, created_at, updated_at, last_seen_at
				 from sandbox
				 where run_id = $1
				 for update`,
				[input.runId],
			);
			if (!sandboxResult.rowCount) {
				throw new Error(`queue command: missing sandbox ${input.runId}`);
			}

			let inserted = false;
			let commandResult = input.dedupeKey
				? await client.query<RunCommandRow>(
						`select run_id, seq, kind, payload, dedupe_key, state, claimed_by,
						 claimed_at, lease_expires_at, done_at, error, created_at
						 from run_command
						 where run_id = $1 and dedupe_key = $2`,
						[input.runId, input.dedupeKey],
					)
				: { rows: [], rowCount: 0 };

			if (!commandResult.rowCount) {
				const seqResult = await client.query<{ seq: string | number }>(
					`update sandbox
					 set next_command_seq = next_command_seq + 1,
						 updated_at = now()
					 where run_id = $1
					 returning next_command_seq - 1 as seq`,
					[input.runId],
				);
				const seq = Number(requireRow(seqResult, "allocate command seq").seq);
				commandResult = await client.query<RunCommandRow>(
					`insert into run_command(run_id, seq, kind, payload, dedupe_key, state)
					 values ($1, $2, $3, $4::jsonb, $5, 'queued')
					 returning run_id, seq, kind, payload, dedupe_key, state, claimed_by,
					 claimed_at, lease_expires_at, done_at, error, created_at`,
					[
						input.runId,
						seq,
						input.kind,
						JSON.stringify(input.payload),
						input.dedupeKey ?? null,
					],
				);
				inserted = true;
			}

			const firstPendingSeq = await this.getFirstPendingSeqFrom(
				client,
				input.runId,
			);
			await client.query("commit");
			return {
				command: toRunCommandModel(
					requireRow(commandResult, "queue command row"),
				),
				created: inserted,
				firstPendingSeq,
			};
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	async acquireLease(input: {
		runId: string;
		workflowId: string;
		leaseMs: number;
	}): Promise<boolean> {
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			const result = await client.query<SandboxRow>(
				`update sandbox
				 set inflight_workflow_id = $2,
					 lease_expires_at = now() + ($3 * interval '1 millisecond'),
					 updated_at = now()
				 where run_id = $1
				   and (
					 inflight_workflow_id is null
					 or lease_expires_at is null
					 or lease_expires_at < now()
					 or inflight_workflow_id = $2
				   )
				 returning run_id, sandbox_id, backend, profile, state, approval_state,
				 spec, preview_spec, container_name, work_volume, inflight_workflow_id,
				 lease_expires_at, workspace_ref, created_at, updated_at, last_seen_at`,
				[input.runId, input.workflowId, input.leaseMs],
			);
			if (!result.rowCount) {
				await client.query("rollback");
				return false;
			}
			await client.query("commit");
			return true;
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	async claimNextCommand(input: {
		runId: string;
		workflowId: string;
	}): Promise<RunCommandModel | null> {
		const result = await this.pool.query<RunCommandRow>(
			`with claimable as (
				 select rc.run_id, rc.seq
				 from run_command rc
				 join sandbox s on s.run_id = rc.run_id
				 where rc.run_id = $1
				   and s.inflight_workflow_id = $2
				   and (
					 s.approval_state <> 'pending'
					 or rc.kind = 'approve'
				   )
				   and (
					 rc.state = 'queued'
					 or (
						rc.state = 'claimed'
						and rc.lease_expires_at < now()
					 )
				   )
				 order by rc.seq asc
				 for update skip locked
				 limit 1
			 )
			 update run_command as rc
			 set state = 'claimed',
				 claimed_by = $2,
				 claimed_at = now(),
				 lease_expires_at = (
					select lease_expires_at from sandbox where sandbox.run_id = rc.run_id
				 )
			 from claimable
			 where rc.run_id = claimable.run_id
			   and rc.seq = claimable.seq
			 returning rc.run_id, rc.seq, rc.kind, rc.payload, rc.dedupe_key,
			 rc.state, rc.claimed_by, rc.claimed_at, rc.lease_expires_at, rc.done_at,
			 rc.error, rc.created_at`,
			[input.runId, input.workflowId],
		);
		if (!result.rowCount) {
			return null;
		}
		return toRunCommandModel(requireRow(result, "claim next command"));
	}

	async persistExec(input: {
		runId: string;
		workflowId: string;
		commandSeq: number;
		commandKind: RunCommandKind;
		result: ExecResult;
		workspaceRef?: { sha256: string } | undefined;
		sandboxState?: SandboxState | undefined;
	}): Promise<{
		exec: SandboxExecModel;
		sandbox: SandboxModel;
		nextPendingSeq: number | null;
	}> {
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			const execResult = await client.query<SandboxExecRow>(
				`insert into sandbox_exec(
					 run_id,
					 command_seq,
					 command_kind,
					 status,
					 exit_code,
					 stdout_tail,
					 stderr_tail,
					 stdout_bytes,
					 stderr_bytes,
					 timeout_sec,
					 max_bytes_out,
					 stdout_ref,
					 stderr_ref,
					 workspace_ref,
					 started_at,
					 ended_at
				 )
				 values (
					 $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
					 $15::timestamptz, $16::timestamptz
				 )
				 on conflict (run_id, command_seq) do update
				 set status = excluded.status,
					 exit_code = excluded.exit_code,
					 stdout_tail = excluded.stdout_tail,
					 stderr_tail = excluded.stderr_tail,
					 stdout_bytes = excluded.stdout_bytes,
					 stderr_bytes = excluded.stderr_bytes,
					 timeout_sec = excluded.timeout_sec,
					 max_bytes_out = excluded.max_bytes_out,
					 stdout_ref = coalesce(excluded.stdout_ref, sandbox_exec.stdout_ref),
					 stderr_ref = coalesce(excluded.stderr_ref, sandbox_exec.stderr_ref),
					 workspace_ref = coalesce(excluded.workspace_ref, sandbox_exec.workspace_ref),
					 started_at = sandbox_exec.started_at,
					 ended_at = coalesce(excluded.ended_at, sandbox_exec.ended_at)
				 returning exec_id, run_id, command_seq, command_kind, status,
				 exit_code, stdout_tail, stderr_tail, stdout_bytes, stderr_bytes,
				 timeout_sec, max_bytes_out, stdout_ref, stderr_ref, workspace_ref,
				 started_at, ended_at`,
				[
					input.runId,
					input.commandSeq,
					input.commandKind,
					input.result.status,
					input.result.exitCode,
					input.result.stdoutTail,
					input.result.stderrTail,
					input.result.stdoutBytes,
					input.result.stderrBytes,
					input.result.timeoutSec,
					input.result.maxBytesOut,
					input.result.stdoutRef?.sha256 ?? null,
					input.result.stderrRef?.sha256 ?? null,
					input.workspaceRef?.sha256 ??
						input.result.workspaceRef?.sha256 ??
						null,
					input.result.startedAt,
					input.result.endedAt,
				],
			);
			await client.query(
				`update run_command
				 set state = 'done',
					 done_at = now(),
					 error = null
				 where run_id = $1
				   and seq = $2
				   and claimed_by = $3`,
				[input.runId, input.commandSeq, input.workflowId],
			);
			const sandboxResult = await client.query<SandboxRow>(
				`update sandbox
				 set state = $2,
					 workspace_ref = coalesce($3, workspace_ref),
					 last_command_seq = greatest(last_command_seq, $4),
					 last_seen_at = now(),
					 updated_at = now()
				 where run_id = $1
				 returning run_id, sandbox_id, backend, profile, state, approval_state,
				 spec, preview_spec, container_name, work_volume, inflight_workflow_id,
				 lease_expires_at, workspace_ref, created_at, updated_at, last_seen_at`,
				[
					input.runId,
					input.sandboxState ?? "ready",
					input.workspaceRef?.sha256 ??
						input.result.workspaceRef?.sha256 ??
						null,
					input.commandSeq,
				],
			);
			const nextPendingSeq = await this.getFirstPendingSeqFrom(
				client,
				input.runId,
			);
			await client.query("commit");
			return {
				exec: toSandboxExecModel(requireRow(execResult, "persist exec row")),
				sandbox: toSandboxModel(
					requireRow(sandboxResult, "persist exec sandbox row"),
				),
				nextPendingSeq,
			};
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	async markCommandDead(input: {
		runId: string;
		workflowId: string;
		commandSeq: number;
		error: string;
	}): Promise<number | null> {
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			await client.query(
				`update run_command
				 set state = 'dead',
					 done_at = now(),
					 error = $4
				 where run_id = $1
				   and seq = $2
				   and claimed_by = $3`,
				[input.runId, input.commandSeq, input.workflowId, input.error],
			);
			const nextPendingSeq = await this.getFirstPendingSeqFrom(
				client,
				input.runId,
			);
			await client.query("commit");
			return nextPendingSeq;
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	async requeueCommand(input: {
		runId: string;
		workflowId: string;
		commandSeq: number;
		error: string;
	}): Promise<number | null> {
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			await client.query(
				`update run_command
				 set state = 'queued',
					 claimed_by = null,
					 claimed_at = null,
					 lease_expires_at = null,
					 done_at = null,
					 error = $4
				 where run_id = $1
				   and seq = $2
				   and claimed_by = $3`,
				[input.runId, input.commandSeq, input.workflowId, input.error],
			);
			const nextPendingSeq = await this.getFirstPendingSeqFrom(
				client,
				input.runId,
			);
			await client.query("commit");
			return nextPendingSeq;
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	async releaseLease(runId: string, workflowId: string): Promise<void> {
		await this.pool.query(
			`update sandbox
			 set inflight_workflow_id = null,
				 lease_expires_at = null,
				 updated_at = now()
			 where run_id = $1 and inflight_workflow_id = $2`,
			[runId, workflowId],
		);
	}

	async markApproved(runId: string): Promise<SandboxModel | null> {
		const result = await this.pool.query<SandboxRow>(
			`update sandbox
			 set approval_state = case
			   when approval_state = 'pending' then 'approved'
			   else approval_state
			 end,
			 updated_at = now()
			 where run_id = $1
			 returning run_id, sandbox_id, backend, profile, state, approval_state,
			 spec, preview_spec, container_name, work_volume, inflight_workflow_id,
			 lease_expires_at, workspace_ref, created_at, updated_at, last_seen_at`,
			[runId],
		);
		if (!result.rowCount) {
			return null;
		}
		return toSandboxModel(requireRow(result, "mark approved"));
	}

	async getCurrentCommand(runId: string): Promise<RunCommandModel | null> {
		const result = await this.pool.query<RunCommandRow>(
			`select run_id, seq, kind, payload, dedupe_key, state, claimed_by,
			 claimed_at, lease_expires_at, done_at, error, created_at
			 from run_command
			 where run_id = $1
			 order by
			   case when state in ('queued', 'claimed') then 0 else 1 end asc,
			   case when state in ('queued', 'claimed') then seq end asc,
			   case when state not in ('queued', 'claimed') then seq end desc
			 limit 1`,
			[runId],
		);
		if (!result.rowCount) {
			return null;
		}
		return toRunCommandModel(requireRow(result, "get current command"));
	}

	async listExecs(runId: string): Promise<SandboxExecModel[]> {
		const result = await this.pool.query<SandboxExecRow>(
			`select exec_id, run_id, command_seq, command_kind, status, exit_code,
			 stdout_tail, stderr_tail, stdout_bytes, stderr_bytes, timeout_sec,
			 max_bytes_out, stdout_ref, stderr_ref, workspace_ref, started_at,
			 ended_at
			 from sandbox_exec
			 where run_id = $1
			 order by started_at asc, exec_id asc`,
			[runId],
		);
		return result.rows.map(toSandboxExecModel);
	}

	private async getFirstPendingSeqFrom(
		queryable: Queryable,
		runId: string,
	): Promise<number | null> {
		const result = await queryable.query<PendingSeqRow>(
			`select min(seq) as seq
			 from run_command
			 where run_id = $1 and state in ('queued', 'claimed')`,
			[runId],
		);
		const value = requireRow(result, "get first sandbox pending seq").seq;
		return value == null ? null : Number(value);
	}
}
