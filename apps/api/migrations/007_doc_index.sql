alter table if exists chunks add column if not exists tsv tsvector;

update chunks
set tsv = to_tsvector('english', coalesce(plain, ''))
where tsv is null;

create index if not exists chunks_tsv_gin_idx on chunks using gin(tsv);

create table if not exists chunk_vec(
  chunk_id text primary key references chunks(chunk_id) on delete cascade,
  emb_json jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  begin
    create extension if not exists vector;
  exception
    when others then
      null;
  end;

  if to_regtype('vector') is not null then
    execute 'alter table chunk_vec add column if not exists emb vector(1536)';
    execute '
      update chunk_vec
      set emb = (emb_json::text)::vector
      where emb is null
        and jsonb_typeof(emb_json) = ''array''
        and jsonb_array_length(emb_json) = 1536
    ';
    if not exists (
      select 1
      from pg_indexes
      where schemaname = 'public'
        and indexname = 'chunk_vec_hnsw_idx'
    ) then
      execute 'create index chunk_vec_hnsw_idx on chunk_vec using hnsw (emb vector_l2_ops)';
    end if;
  end if;
end $$;

create index if not exists chunk_vec_updated_idx on chunk_vec(updated_at desc);
