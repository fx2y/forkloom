create table if not exists sandbox(
  run_id text primary key references runs(run_id) on delete cascade,
  sandbox_id text not null unique,
  backend text not null check (backend in ('docker')),
  profile text not null check (profile in ('safe', 'std', 'priv')),
  state text not null check (state in ('missing', 'ready', 'sleeping', 'recreating', 'failed')),
  approval_state text not null check (approval_state in ('not_required', 'pending', 'approved')),
  spec jsonb not null default '{}'::jsonb,
  preview_spec jsonb not null default '{}'::jsonb,
  container_name text not null,
  work_volume text not null,
  workspace_ref text,
  next_command_seq bigint not null default 1,
  last_command_seq bigint not null default 0,
  inflight_workflow_id text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (container_name),
  unique (work_volume)
);

create index if not exists sandbox_state_updated_idx
  on sandbox(state, updated_at desc);

create index if not exists sandbox_lease_idx
  on sandbox(lease_expires_at)
  where inflight_workflow_id is not null;

create table if not exists run_command(
  run_id text not null references sandbox(run_id) on delete cascade,
  seq bigint not null,
  kind text not null check (kind in ('prompt', 'followUp', 'steer', 'abort', 'approve')),
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text,
  state text not null default 'queued' check (state in ('queued', 'claimed', 'done', 'dead')),
  claimed_by text,
  claimed_at timestamptz,
  lease_expires_at timestamptz,
  done_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  primary key(run_id, seq),
  unique (run_id, seq)
);

create unique index if not exists run_command_run_dedupe_idx
  on run_command(run_id, dedupe_key)
  where dedupe_key is not null;

create index if not exists run_command_claim_idx
  on run_command(run_id, state, seq);

create index if not exists run_command_lease_idx
  on run_command(run_id, lease_expires_at, seq)
  where state = 'claimed';

create table if not exists sandbox_exec(
  exec_id bigserial primary key,
  run_id text not null references sandbox(run_id) on delete cascade,
  command_seq bigint not null,
  command_kind text not null check (command_kind in ('prompt', 'followUp', 'steer', 'abort', 'approve')),
  status text not null check (status in ('running', 'done', 'failed', 'aborted')),
  exit_code integer,
  stdout_tail text not null default '',
  stderr_tail text not null default '',
  stdout_bytes bigint not null default 0,
  stderr_bytes bigint not null default 0,
  timeout_sec integer not null,
  max_bytes_out integer not null,
  stdout_ref text,
  stderr_ref text,
  workspace_ref text,
  started_at timestamptz not null,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, command_seq),
  foreign key (run_id, command_seq) references run_command(run_id, seq) on delete cascade
);

create index if not exists sandbox_exec_run_created_idx
  on sandbox_exec(run_id, created_at desc, exec_id desc);
