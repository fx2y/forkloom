import pg from "pg";
import { ActorNotFoundError } from "../errors";
import { toMailboxFailedEffect } from "../event";
import type {
	ActorBatchEffect,
	ActorEventModel,
	ActorMailboxMessageModel,
	ActorMailboxPostResult,
	ActorRepo,
	ActorSpecModel,
	ActorStateModel,
	ActorStatus,
	MailboxPostModel,
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

type ActorRow = {
	actor_id: string;
	name: string;
	status: ActorStatus;
	mailbox_cursor: string | number;
	next_mailbox_seq: string | number;
	inflight_workflow_id: string | null;
	pi_session_id: string | null;
	pi_session_file: string | null;
	mem_ref: string | null;
	workspace_id: string | null;
	updated_at: Date | string;
};

type MailboxRow = {
	msg_id: string | number;
	actor_id: string;
	seq: string | number;
	kind: ActorMailboxMessageModel["kind"];
	payload: {
		text?: unknown;
		attachments?: unknown;
		metadata?: unknown;
	} | null;
	dedupe_key: string | null;
	state: ActorMailboxMessageModel["state"];
	claimed_by: string | null;
	claimed_at: Date | string | null;
	claim_lease_ms: string | number;
	done_at: Date | string | null;
	error: string | null;
	created_at: Date | string;
};

type EventRow = {
	seq: string | number;
	actor_id: string;
	kind: string;
	payload: Record<string, unknown> | null;
	created_at: Date | string;
};

type PendingSeqRow = {
	seq: string | number | null;
};

export type PgActorRepoDeps = {
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

function asRecord(value: unknown): Record<string, unknown> {
	if (value == null || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	return value as Record<string, unknown>;
}

function asAttachments(value: unknown): MailboxPostModel["attachments"] {
	if (!Array.isArray(value)) {
		return [];
	}
	return value.flatMap((item) => {
		if (
			item &&
			typeof item === "object" &&
			typeof (item as { sha256?: unknown }).sha256 === "string"
		) {
			return [{ sha256: (item as { sha256: string }).sha256 }];
		}
		return [];
	});
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

function toActorStateModel(row: ActorRow): ActorStateModel {
	return {
		actorId: row.actor_id,
		name: row.name,
		status: row.status,
		mailboxCursor: Number(row.mailbox_cursor),
		nextMailboxSeq: Number(row.next_mailbox_seq),
		inflightWorkflowId: row.inflight_workflow_id,
		piSessionId: row.pi_session_id,
		piSessionFile: row.pi_session_file,
		memRef: row.mem_ref,
		workspaceId: row.workspace_id,
		updatedAt: asIsoString(row.updated_at) ?? new Date(0).toISOString(),
	};
}

function toMailboxMessageModel(row: MailboxRow): ActorMailboxMessageModel {
	const payload = asRecord(row.payload);
	return {
		msgId: Number(row.msg_id),
		actorId: row.actor_id,
		seq: Number(row.seq),
		kind: row.kind,
		text: typeof payload.text === "string" ? payload.text : "",
		attachments: asAttachments(payload.attachments),
		dedupeKey: row.dedupe_key,
		metadata: asRecord(payload.metadata),
		state: row.state,
		claimedBy: row.claimed_by,
		claimedAt: asIsoString(row.claimed_at),
		claimLeaseMs: Number(row.claim_lease_ms),
		doneAt: asIsoString(row.done_at),
		error: row.error,
		createdAt: asIsoString(row.created_at) ?? new Date(0).toISOString(),
	};
}

function toActorEventModel(row: EventRow): ActorEventModel {
	const seq = Number(row.seq);
	return {
		eventId: seq,
		actorId: row.actor_id,
		seq,
		kind: row.kind,
		payload: row.payload ?? {},
		createdAt: asIsoString(row.created_at) ?? new Date(0).toISOString(),
	};
}

export class PgActorRepo implements ActorRepo {
	private readonly pool: PoolLike;

	constructor(deps: PgActorRepoDeps) {
		this.pool =
			deps.pool ?? new pg.Pool({ connectionString: deps.databaseUrl });
	}

	async close(): Promise<void> {
		await this.pool.end();
	}

	async createActor(spec: ActorSpecModel): Promise<ActorStateModel> {
		const result = await this.pool.query<ActorRow>(
			`insert into actor(
				 actor_id,
				 name,
				 status,
				 workspace_id,
				 mem_ref,
				 pi_session_id
			 )
				 values ($1, $2, $3, $4, $5, $6)
				 on conflict (actor_id) do update
				 set name = excluded.name,
					 workspace_id = coalesce(excluded.workspace_id, actor.workspace_id),
					 mem_ref = coalesce(excluded.mem_ref, actor.mem_ref),
					 pi_session_id = coalesce(excluded.pi_session_id, actor.pi_session_id),
					 updated_at = now()
			 returning actor_id, name, status, mailbox_cursor, next_mailbox_seq,
			 inflight_workflow_id, pi_session_id, pi_session_file, mem_ref,
			 workspace_id, updated_at`,
			[
				spec.actorId,
				spec.name,
				spec.status,
				spec.workspaceId ?? null,
				spec.memRef ?? null,
				spec.piSessionId ?? null,
			],
		);
		return toActorStateModel(requireRow(result, "create actor"));
	}

	async listActors(): Promise<ActorStateModel[]> {
		const result = await this.pool.query<ActorRow>(
			`select actor_id, name, status, mailbox_cursor, next_mailbox_seq,
			 inflight_workflow_id, pi_session_id, pi_session_file, mem_ref,
			 workspace_id, updated_at
			 from actor
			 order by updated_at desc, actor_id asc`,
		);
		return result.rows.map(toActorStateModel);
	}

	async getActorState(actorId: string): Promise<ActorStateModel | null> {
		const result = await this.pool.query<ActorRow>(
			`select actor_id, name, status, mailbox_cursor, next_mailbox_seq,
			 inflight_workflow_id, pi_session_id, pi_session_file, mem_ref,
			 workspace_id, updated_at
			 from actor
			 where actor_id = $1`,
			[actorId],
		);
		if (!result.rowCount) {
			return null;
		}
		return toActorStateModel(requireRow(result, "get actor"));
	}

	async listActorEvents(
		actorId: string,
		sinceEventId: number,
		limit: number,
	): Promise<ActorEventModel[]> {
		const result = await this.pool.query<EventRow>(
			`select seq, actor_id, kind, payload, created_at
			 from actor_event
			 where actor_id = $1 and seq > $2
			 order by seq asc
			 limit $3`,
			[actorId, sinceEventId, limit],
		);
		return result.rows.map(toActorEventModel);
	}

	async postMailboxMessage(
		input: MailboxPostModel,
	): Promise<ActorMailboxPostResult> {
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			const actor = await client.query<ActorRow>(
				`select actor_id, name, status, mailbox_cursor, next_mailbox_seq,
				 inflight_workflow_id, pi_session_id, pi_session_file, mem_ref,
				 workspace_id, updated_at
				 from actor
				 where actor_id = $1
				 for update`,
				[input.actorId],
				);
				if (!actor.rowCount) {
					throw new ActorNotFoundError(input.actorId);
				}

			let insertedMailbox = false;
			let mailboxResult = input.dedupeKey
				? await client.query<MailboxRow>(
						`select msg_id, actor_id, seq, kind, payload, dedupe_key, state,
						 claimed_by, claimed_at, claim_lease_ms, done_at, error, created_at
						 from mailbox_msg
						 where actor_id = $1 and dedupe_key = $2`,
						[input.actorId, input.dedupeKey],
					)
				: { rows: [], rowCount: 0 };

			if (!mailboxResult.rowCount) {
				const seqRow = await client.query<{ seq: string | number }>(
					`update actor
					 set next_mailbox_seq = next_mailbox_seq + 1,
						 updated_at = now()
					 where actor_id = $1
					 returning next_mailbox_seq - 1 as seq`,
					[input.actorId],
				);
				const seq = Number(requireRow(seqRow, "allocate mailbox seq").seq);
				mailboxResult = await client.query<MailboxRow>(
					`insert into mailbox_msg(
						 actor_id,
						 seq,
						 kind,
						 payload,
						 dedupe_key,
						 state
					 )
					 values ($1, $2, $3, $4::jsonb, $5, 'queued')
					 returning msg_id, actor_id, seq, kind, payload, dedupe_key, state,
					 claimed_by, claimed_at, claim_lease_ms, done_at, error, created_at`,
					[
						input.actorId,
						seq,
						input.kind,
						JSON.stringify({
							text: input.text,
							attachments: input.attachments,
							metadata: input.metadata ?? {},
						}),
						input.dedupeKey ?? null,
					],
				);
				insertedMailbox = true;
			}

			const message = toMailboxMessageModel(
				requireRow(mailboxResult, "insert mailbox message"),
			);
				const eventPayload = JSON.stringify({
					msgId: message.msgId,
					seq: message.seq,
					kind: message.kind,
					attachments: message.attachments,
				});
			const eventResult = insertedMailbox
				? await client.query<EventRow>(
						`insert into actor_event(actor_id, kind, payload)
						 values ($1, 'mailbox_queued', $2::jsonb)
						 returning seq, actor_id, kind, payload, created_at`,
						[input.actorId, eventPayload],
					)
				: await client.query<EventRow>(
						`select seq, actor_id, kind, payload, created_at
						 from actor_event
						 where actor_id = $1
						   and kind = 'mailbox_queued'
						   and payload ->> 'msgId' = $2
						 order by seq asc
						 limit 1`,
						[input.actorId, String(message.msgId)],
					);
			if (!eventResult.rowCount) {
				throw new Error(
					`post mailbox message: missing mailbox_queued event ${message.msgId}`,
				);
			}
			const pendingSeq = await this.getFirstPendingSeqFrom(
				client,
				input.actorId,
			);
			await client.query("commit");
			return {
				message,
				event: toActorEventModel(
					requireRow(eventResult, "append mailbox queued event"),
				),
				firstPendingSeq: pendingSeq ?? message.seq,
			};
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	async acquireTickLease(input: {
		actorId: string;
		workflowId: string;
		leaseMs: number;
	}): Promise<boolean> {
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			const lockResult = await client.query<{ actor_id: string }>(
				`insert into actor_lock(actor_id, lock_owner, lease_ms)
				 values ($1, $2, $3)
				 on conflict (actor_id) do update
				 set lock_owner = excluded.lock_owner,
					 locked_at = now(),
					 lease_ms = excluded.lease_ms
				 where actor_lock.locked_at <
					now() - (actor_lock.lease_ms * interval '1 millisecond')
				 returning actor_id`,
				[input.actorId, input.workflowId, input.leaseMs],
			);
			if (!lockResult.rowCount) {
				await client.query("rollback");
				return false;
			}
			await client.query(
				`update actor
				 set inflight_workflow_id = $2,
					 updated_at = now()
				 where actor_id = $1`,
				[input.actorId, input.workflowId],
			);
			await client.query("commit");
			return true;
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	async claimNextMessages(input: {
		actorId: string;
		workflowId: string;
		maxMessages: number;
	}): Promise<ActorMailboxMessageModel[]> {
		const result = await this.pool.query<MailboxRow>(
			`with claimable as (
				 select msg_id
				 from mailbox_msg
				 where actor_id = $1
				   and exists (
					 select 1
					 from actor
					 where actor.actor_id = mailbox_msg.actor_id
					   and actor.status not in ('blocked', 'dead')
				   )
					   and (
						 state = 'queued'
						 or (
						state = 'claimed'
						and claimed_at <
							now() - (claim_lease_ms * interval '1 millisecond')
					 )
				   )
				 order by seq asc
				 for update skip locked
				 limit $3
			 )
			 update mailbox_msg as m
			 set state = 'claimed',
				 claimed_by = $2,
				 claimed_at = now()
			 from claimable
			 where m.msg_id = claimable.msg_id
			 returning m.msg_id, m.actor_id, m.seq, m.kind, m.payload, m.dedupe_key,
			 m.state, m.claimed_by, m.claimed_at, m.claim_lease_ms, m.done_at,
			 m.error, m.created_at`,
			[input.actorId, input.workflowId, input.maxMessages],
		);
		return result.rows
			.map(toMailboxMessageModel)
			.sort((left, right) => left.seq - right.seq);
	}

	async persistProcessedBatch(input: {
		actorId: string;
		workflowId: string;
		seqs: number[];
		actorStatus?: ActorStatus | undefined;
		piSessionId?: string | undefined;
		piSessionFile?: string | undefined;
		events: ActorBatchEffect[];
	}): Promise<{
		actor: ActorStateModel;
		events: ActorEventModel[];
		mailboxCursor: number;
		remainingPendingSeq: number | null;
	}> {
		if (input.seqs.length === 0) {
			const actor = await this.getActorState(input.actorId);
			if (!actor) {
				throw new Error(
					`persist processed batch: missing actor ${input.actorId}`,
				);
			}
			return {
				actor,
				events: [],
				mailboxCursor: actor.mailboxCursor,
				remainingPendingSeq: await this.getFirstPendingSeq(input.actorId),
			};
		}
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			const rows: ActorEventModel[] = [];
			for (const event of input.events) {
				const result = await client.query<EventRow>(
					`insert into actor_event(actor_id, kind, payload)
					 values ($1, $2, $3::jsonb)
					 returning seq, actor_id, kind, payload, created_at`,
					[input.actorId, event.kind, JSON.stringify(event.payload)],
				);
				rows.push(toActorEventModel(requireRow(result, "append actor event")));
			}
			await client.query(
				`update mailbox_msg
				 set state = 'done',
					 done_at = now(),
					 error = null
				 where actor_id = $1
				   and claimed_by = $2
				   and seq = any($3::bigint[])`,
				[input.actorId, input.workflowId, input.seqs],
			);
			const highestSeq = Math.max(...input.seqs);
			const actorResult = await client.query<ActorRow>(
				`update actor
				 set mailbox_cursor = greatest(mailbox_cursor, $2),
					 status = $3,
					 pi_session_id = coalesce($4, pi_session_id),
					 pi_session_file = coalesce($5, pi_session_file),
					 updated_at = now()
				 where actor_id = $1
				 returning actor_id, name, status, mailbox_cursor, next_mailbox_seq,
				 inflight_workflow_id, pi_session_id, pi_session_file, mem_ref,
				 workspace_id, updated_at`,
				[
					input.actorId,
					highestSeq,
					input.actorStatus ?? "idle",
					input.piSessionId ?? null,
					input.piSessionFile ?? null,
				],
			);
			const actor = toActorStateModel(
				requireRow(actorResult, "persist processed actor batch"),
			);
			const remainingPendingSeq = await this.getFirstPendingSeqFrom(
				client,
				input.actorId,
			);
			await client.query("commit");
			return {
				actor,
				events: rows,
				mailboxCursor: actor.mailboxCursor,
				remainingPendingSeq,
			};
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	async markMessagesDead(input: {
		actorId: string;
		workflowId: string;
		seqs: number[];
		error: string;
		actorStatus?: ActorStatus | undefined;
		}): Promise<{ remainingPendingSeq: number | null }> {
		const finished = await this.finishBatch({
			actorId: input.actorId,
			workflowId: input.workflowId,
			seqs: input.seqs,
			nextState: "dead",
			error: input.error,
			actorStatus: input.actorStatus ?? "blocked",
		});
		return { remainingPendingSeq: finished.remainingPendingSeq };
	}

	async requeueMessages(input: {
		actorId: string;
		workflowId: string;
		seqs: number[];
	}): Promise<{ remainingPendingSeq: number | null }> {
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			await client.query(
				`update mailbox_msg
				 set state = 'queued',
					 claimed_by = null,
					 claimed_at = null,
					 done_at = null,
					 error = null
				 where actor_id = $1
				   and claimed_by = $2
				   and seq = any($3::bigint[])`,
				[input.actorId, input.workflowId, input.seqs],
			);
			const remainingPendingSeq = await this.getFirstPendingSeqFrom(
				client,
				input.actorId,
			);
			await client.query("commit");
			return { remainingPendingSeq };
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	async getFirstPendingSeq(actorId: string): Promise<number | null> {
		return this.getFirstPendingSeqFrom(this.pool, actorId);
	}

	async releaseTickLease(actorId: string, workflowId: string): Promise<void> {
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			await client.query(
				`delete from actor_lock
				 where actor_id = $1 and lock_owner = $2`,
				[actorId, workflowId],
			);
			await client.query(
				`update actor
				 set inflight_workflow_id = null,
					 updated_at = now()
				 where actor_id = $1 and inflight_workflow_id = $2`,
				[actorId, workflowId],
			);
			await client.query("commit");
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	private async finishBatch(input: {
		actorId: string;
		workflowId: string;
		seqs: number[];
		nextState: "done" | "dead";
		error: string | null;
		actorStatus: ActorStatus;
		events?: ActorBatchEffect[] | undefined;
	}): Promise<{ mailboxCursor: number; remainingPendingSeq: number | null }> {
		if (input.seqs.length === 0) {
			return {
				mailboxCursor: 0,
				remainingPendingSeq: await this.getFirstPendingSeq(input.actorId),
			};
		}
		const client = await this.pool.connect();
		try {
			await client.query("begin");
			let deadEvents = input.events ?? [];
			if (input.nextState === "dead") {
				const claimedRows = await client.query<{
					seq: string | number;
					kind: ActorMailboxMessageModel["kind"];
				}>(
					`select seq, kind
					 from mailbox_msg
					 where actor_id = $1
					   and claimed_by = $2
					   and seq = any($3::bigint[])`,
					[input.actorId, input.workflowId, input.seqs],
				);
				deadEvents = claimedRows.rows.map((row) =>
					toMailboxFailedEffect({
						seq: Number(row.seq),
						kind: row.kind,
						error: input.error ?? "unknown error",
					}),
				);
			}
			for (const event of deadEvents) {
				await client.query(
					`insert into actor_event(actor_id, kind, payload)
					 values ($1, $2, $3::jsonb)`,
					[input.actorId, event.kind, JSON.stringify(event.payload)],
				);
			}
			await client.query(
				`update mailbox_msg
				 set state = $4,
					 done_at = now(),
					 error = $5
				 where actor_id = $1
				   and claimed_by = $2
				   and seq = any($3::bigint[])`,
				[
					input.actorId,
					input.workflowId,
					input.seqs,
					input.nextState,
					input.error,
				],
			);
			const highestSeq = Math.max(...input.seqs);
			const actorResult = await client.query<ActorRow>(
				`update actor
				 set mailbox_cursor = greatest(mailbox_cursor, $2),
					 status = $3,
					 updated_at = now()
				 where actor_id = $1
				 returning actor_id, name, status, mailbox_cursor, next_mailbox_seq,
				 inflight_workflow_id, pi_session_id, pi_session_file, mem_ref,
				 workspace_id, updated_at`,
				[input.actorId, highestSeq, input.actorStatus],
			);
			const mailboxCursor = Number(
				requireRow(actorResult, "finish actor batch").mailbox_cursor,
			);
			const remainingPendingSeq = await this.getFirstPendingSeqFrom(
				client,
				input.actorId,
			);
			await client.query("commit");
			return { mailboxCursor, remainingPendingSeq };
		} catch (error) {
			await client.query("rollback");
			throw error;
		} finally {
			client.release();
		}
	}

	private async getFirstPendingSeqFrom(
		queryable: Queryable,
		actorId: string,
	): Promise<number | null> {
		const result = await queryable.query<PendingSeqRow>(
			`select min(seq) as seq
			 from mailbox_msg
			 where actor_id = $1 and state in ('queued', 'claimed')`,
			[actorId],
		);
		const value = requireRow(result, "get first pending seq").seq;
		return value == null ? null : Number(value);
	}
}
