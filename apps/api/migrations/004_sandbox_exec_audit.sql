alter table sandbox_exec
  add column if not exists cmd_list jsonb not null default '[]'::jsonb,
  add column if not exists artifact_reads jsonb not null default '[]'::jsonb,
  add column if not exists artifact_writes jsonb not null default '[]'::jsonb;
