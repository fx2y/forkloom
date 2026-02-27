create table if not exists runs(
  run_id text primary key,
  status text not null check (status in ('queued', 'running', 'done', 'failed')),
  spec jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  dbos_workflow_id text,
  pi_session_id text,
  pi_session_file text,
  result_text text,
  error text
);

create index if not exists runs_status_idx on runs(status, updated_at desc);

create table if not exists events(
  event_id bigserial primary key,
  run_id text not null references runs(run_id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists events_run_id_event_id on events(run_id, event_id);

create table if not exists run_artifacts(
  run_id text not null references runs(run_id) on delete cascade,
  sha256 text not null references artifact(sha256) on delete restrict,
  kind text not null,
  created_at timestamptz not null default now(),
  primary key(run_id, sha256, kind)
);

create index if not exists run_artifacts_run_idx on run_artifacts(run_id, created_at desc);
