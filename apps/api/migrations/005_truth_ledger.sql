create table if not exists steps(
  run_id text not null references runs(run_id) on delete cascade,
  step_name text not null,
  attempt integer not null default 0 check (attempt >= 0),
  step_key text not null,
  in_hash text not null,
  out_hash text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key(run_id, step_name, attempt)
);

create index if not exists steps_run_started_idx
  on steps(run_id, started_at desc);

create table if not exists links(
  run_id text not null,
  step_name text not null,
  attempt integer not null default 0 check (attempt >= 0),
  session_entry_ids text[] not null default '{}',
  artifact_shas text[] not null default '{}',
  note text,
  created_at timestamptz not null default now(),
  primary key(run_id, step_name, attempt),
  foreign key(run_id, step_name, attempt)
    references steps(run_id, step_name, attempt)
    on delete cascade
);

create index if not exists links_run_step_idx
  on links(run_id, step_name, attempt);

create table if not exists sessions_index(
  run_id text primary key references runs(run_id) on delete cascade,
  entry_count integer not null check (entry_count >= 0),
  root_id text,
  leaf_id text,
  summary_entry_count integer not null default 0 check (summary_entry_count >= 0),
  updated_at timestamptz not null default now()
);

create index if not exists sessions_index_leaf_idx
  on sessions_index(leaf_id);

create table if not exists step_payloads(
  run_id text not null,
  step_name text not null,
  attempt integer not null default 0 check (attempt >= 0),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key(run_id, step_name, attempt),
  foreign key(run_id, step_name, attempt)
    references steps(run_id, step_name, attempt)
    on delete cascade
);

create index if not exists step_payloads_run_step_idx
  on step_payloads(run_id, step_name, attempt);
