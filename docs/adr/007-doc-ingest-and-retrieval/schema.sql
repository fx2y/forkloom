-- Schema definition for C5 Doc Ingest and Retrieval

CREATE TABLE IF NOT EXISTS docs (
    sha TEXT PRIMARY KEY,
    mime TEXT NOT NULL,
    size_bytes BIGINT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS parses (
    parse_id TEXT PRIMARY KEY,
    doc_sha TEXT NOT NULL REFERENCES docs(sha),
    status TEXT NOT NULL,
    billable_pages INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS spans (
    span_id TEXT PRIMARY KEY,
    parse_id TEXT NOT NULL REFERENCES parses(parse_id),
    page_idx INTEGER NOT NULL,
    bbox JSONB NOT NULL,
    text TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chunks (
    chunk_id TEXT PRIMARY KEY,
    parse_id TEXT NOT NULL REFERENCES parses(parse_id),
    text TEXT NOT NULL,
    prev_id TEXT,
    next_id TEXT,
    parent_id TEXT
);

CREATE TABLE IF NOT EXISTS chunk_vec (
    chunk_id TEXT PRIMARY KEY REFERENCES chunks(chunk_id),
    emb vector(768) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_parse_id ON chunks(parse_id);
CREATE INDEX IF NOT EXISTS idx_spans_parse_id ON spans(parse_id);
