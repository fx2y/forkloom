-- 009_tenancy_core.sql

CREATE TABLE IF NOT EXISTS org (
    org_id uuid PRIMARY KEY,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace (
    ws_id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES org(org_id) ON DELETE CASCADE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS member (
    member_id uuid PRIMARY KEY,
    org_id uuid NOT NULL REFERENCES org(org_id) ON DELETE CASCADE,
    email text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS membership (
    member_id uuid NOT NULL REFERENCES member(member_id) ON DELETE CASCADE,
    ws_id uuid NOT NULL REFERENCES workspace(ws_id) ON DELETE CASCADE,
    role text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (member_id, ws_id)
);

-- Object KV table (Shadowable key store)
CREATE TABLE IF NOT EXISTS object_kv (
    kind text NOT NULL,
    key text NOT NULL,
    org_id uuid NOT NULL REFERENCES org(org_id) ON DELETE CASCADE,
    ws_id uuid,
    member_id uuid,
    body_artifact_sha text REFERENCES artifact(sha256) ON DELETE RESTRICT,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (
        (ws_id IS NULL AND member_id IS NULL) OR
        (ws_id IS NOT NULL AND member_id IS NULL) OR
        (ws_id IS NOT NULL AND member_id IS NOT NULL)
    ),
    PRIMARY KEY (kind, key, org_id, ws_id, member_id)
);

CREATE INDEX IF NOT EXISTS object_kv_lookup_idx ON object_kv (org_id, ws_id, member_id, kind, key, updated_at DESC);
CREATE INDEX IF NOT EXISTS object_kv_org_overlay_idx ON object_kv (org_id, kind, key) WHERE ws_id IS NULL;

-- Add tenancy columns to legacy tables
-- We use NULL temporarily, backfill in 010.

ALTER TABLE runs ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE runs ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

ALTER TABLE events ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE events ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

ALTER TABLE run_artifacts ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE run_artifacts ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE run_artifacts ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

ALTER TABLE sandbox ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE sandbox ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE sandbox ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

ALTER TABLE run_command ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE run_command ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE run_command ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

ALTER TABLE sandbox_exec ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE sandbox_exec ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE sandbox_exec ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

ALTER TABLE steps ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE steps ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE steps ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

ALTER TABLE links ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE links ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE links ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

ALTER TABLE sessions_index ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE sessions_index ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE sessions_index ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

ALTER TABLE docs ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE docs ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE docs ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

ALTER TABLE parses ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE parses ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE parses ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

ALTER TABLE chunks ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE chunks ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

ALTER TABLE spans ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE spans ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE spans ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

-- Enforce tri-shape checks on primary tables after backfill (010 will add NOT NULL where appropriate)
-- For now, we just define the constraints.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'runs_tri_shape_check') THEN
        ALTER TABLE runs ADD CONSTRAINT runs_tri_shape_check CHECK (
            (ws_id IS NULL AND member_id IS NULL) OR
            (ws_id IS NOT NULL AND member_id IS NULL) OR
            (ws_id IS NOT NULL AND member_id IS NOT NULL)
        );
    END IF;
END $$;
