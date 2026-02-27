create table if not exists artifact(
  sha256 text primary key,
  uri text not null,
  bytes bigint not null,
  mime text not null,
  type text not null,
  created_at timestamptz not null default now(),
  parents text[] not null default '{}',
  meta jsonb not null default '{}'::jsonb
);

create index if not exists artifact_type_idx on artifact(type);
create index if not exists artifact_created_idx on artifact(created_at);

create table if not exists artifact_alias(
  alias text primary key,
  sha256 text not null references artifact(sha256)
);

create unique index if not exists artifact_alias_sha_idx on artifact_alias(sha256, alias);
