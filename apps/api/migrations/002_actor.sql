create table if not exists actor(
  actor_id text primary key,
  name text not null,
  status text not null check (status in ('idle', 'streaming', 'blocked', 'dead')),
  workspace_id text,
  mem_ref text,
  pi_session_id text,
  pi_session_file text,
  mailbox_cursor bigint not null default 0,
  next_mailbox_seq bigint not null default 1,
  inflight_workflow_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists mailbox_msg(
  msg_id bigserial primary key,
  actor_id text not null references actor(actor_id) on delete cascade,
  seq bigint not null,
  kind text not null check (kind in ('prompt', 'steer', 'followUp', 'system', 'timer', 'agent2agent')),
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  state text not null default 'queued' check (state in ('queued', 'claimed', 'done', 'dead')),
  claimed_by text,
  claimed_at timestamptz,
  claim_lease_ms integer not null default 60000,
  done_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique(actor_id, seq)
);

create unique index if not exists mailbox_msg_actor_dedupe_idx
  on mailbox_msg(actor_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists mailbox_msg_claim_idx
  on mailbox_msg(actor_id, state, seq);

create index if not exists mailbox_msg_state_created_idx
  on mailbox_msg(state, created_at);

create table if not exists actor_lock(
  actor_id text primary key references actor(actor_id) on delete cascade,
  lock_owner text not null,
  locked_at timestamptz not null default now(),
  lease_ms integer not null default 60000
);

create table if not exists actor_event(
  seq bigserial primary key,
  actor_id text not null references actor(actor_id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists actor_event_actor_seq_idx
  on actor_event(actor_id, seq);
