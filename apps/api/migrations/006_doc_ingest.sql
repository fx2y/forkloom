create table if not exists docs(
  doc_sha text primary key,
  mime text not null,
  bytes bigint not null check (bytes >= 0),
  raw_artifact_sha text references artifact(sha256) on delete restrict,
  status text not null check (status in ('queued', 'processing', 'done', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists docs_status_idx on docs(status, updated_at desc);

create table if not exists parses(
  parse_id text primary key,
  doc_sha text not null references docs(doc_sha) on delete cascade,
  parser text not null,
  parser_ver text not null,
  cfg_hash text not null,
  norm_ver text not null default 'v1',
  md_artifact_sha text references artifact(sha256) on delete restrict,
  json_artifact_sha text references artifact(sha256) on delete restrict,
  stats jsonb not null default '{}'::jsonb,
  status text not null check (status in ('queued', 'ocr_running', 'ocr_done', 'indexing', 'done', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists parses_doc_status_idx on parses(doc_sha, status, updated_at desc);

create table if not exists pages(
  parse_id text not null references parses(parse_id) on delete cascade,
  p integer not null check (p >= 1),
  w integer check (w is null or w >= 0),
  h integer check (h is null or h >= 0),
  img_artifact_sha text references artifact(sha256) on delete restrict,
  md_artifact_sha text references artifact(sha256) on delete restrict,
  json_artifact_sha text references artifact(sha256) on delete restrict,
  status text not null check (status in ('queued', 'ocr_running', 'ocr_done', 'indexing', 'done', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(parse_id, p)
);

create index if not exists pages_parse_idx on pages(parse_id, p);

create table if not exists blocks(
  parse_id text not null,
  p integer not null,
  block_path text not null,
  kind text not null,
  bbox jsonb,
  text_md text not null default '',
  text_plain text not null default '',
  payload jsonb not null default '{}'::jsonb,
  parent_path text,
  created_at timestamptz not null default now(),
  primary key(parse_id, p, block_path),
  foreign key(parse_id, p) references pages(parse_id, p) on delete cascade
);

create index if not exists blocks_parse_page_idx on blocks(parse_id, p, block_path);

create table if not exists chunks(
  chunk_id text primary key,
  parse_id text not null,
  p integer not null,
  kind text not null,
  md text not null default '',
  plain text not null default '',
  payload jsonb not null default '{}'::jsonb,
  bbox_union jsonb,
  token_est integer not null default 0 check (token_est >= 0),
  prev_chunk_id text,
  next_chunk_id text,
  parent_chunk_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(parse_id, p) references pages(parse_id, p) on delete cascade
);

create index if not exists chunks_parse_page_idx on chunks(parse_id, p, created_at asc);
create index if not exists chunks_parse_updated_idx on chunks(parse_id, updated_at desc);

create table if not exists spans(
  span_id text primary key,
  chunk_id text not null references chunks(chunk_id) on delete cascade,
  p integer not null check (p >= 1),
  bbox jsonb,
  char_start integer check (char_start is null or char_start >= 0),
  char_end integer check (char_end is null or char_end >= 0),
  block_path text not null,
  src_ref jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists spans_chunk_idx on spans(chunk_id, p, created_at asc);

create table if not exists ocr_usage(
  parse_id text primary key references parses(parse_id) on delete cascade,
  vendor text not null,
  model text not null,
  input_pages integer not null default 0 check (input_pages >= 0),
  input_bytes bigint not null default 0 check (input_bytes >= 0),
  output_tokens integer not null default 0 check (output_tokens >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ocr_usage_vendor_idx on ocr_usage(vendor, model, updated_at desc);
