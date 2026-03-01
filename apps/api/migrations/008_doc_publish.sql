alter table if exists parses
  drop constraint if exists parses_status_check;

alter table if exists parses
  add constraint parses_status_check
  check (status in (
    'queued',
    'ocr_running',
    'ocr_done',
    'norm_done',
    'indexing',
    'indexed',
    'done',
    'failed'
  ));

alter table if exists pages
  drop constraint if exists pages_status_check;

alter table if exists pages
  add constraint pages_status_check
  check (status in (
    'queued',
    'ocr_running',
    'ocr_done',
    'norm_done',
    'indexing',
    'indexed',
    'done',
    'failed'
  ));

create table if not exists doc_ingested(
  parse_id text primary key references parses(parse_id) on delete cascade,
  doc_sha text not null references docs(doc_sha) on delete cascade,
  published_at timestamptz not null,
  status text not null check (status in ('DONE')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists doc_ingested_doc_sha_idx
  on doc_ingested(doc_sha, published_at desc);

