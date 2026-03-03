-- 010_tenancy_backfill.sql

-- 1) Seed default tenancy
INSERT INTO org (org_id, name)
VALUES ('00000000-0000-0000-0000-000000000001', 'Default Org')
ON CONFLICT (org_id) DO NOTHING;

INSERT INTO workspace (ws_id, org_id, name)
VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Default Workspace')
ON CONFLICT (ws_id) DO NOTHING;

INSERT INTO member (member_id, org_id, email)
VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'default@forkloom.io')
ON CONFLICT (member_id) DO NOTHING;

INSERT INTO membership (member_id, ws_id, role)
VALUES ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000002', 'admin')
ON CONFLICT (member_id, ws_id) DO NOTHING;

-- 2) Backfill runs and their direct children
UPDATE runs SET
    org_id = '00000000-0000-0000-0000-000000000001',
    ws_id = '00000000-0000-0000-0000-000000000002'
WHERE org_id IS NULL;

UPDATE events SET
    org_id = r.org_id,
    ws_id = r.ws_id,
    member_id = r.member_id
FROM runs r WHERE events.run_id = r.run_id AND events.org_id IS NULL;

UPDATE run_artifacts SET
    org_id = r.org_id,
    ws_id = r.ws_id,
    member_id = r.member_id
FROM runs r WHERE run_artifacts.run_id = r.run_id AND run_artifacts.org_id IS NULL;

UPDATE sandbox SET
    org_id = r.org_id,
    ws_id = r.ws_id,
    member_id = r.member_id
FROM runs r WHERE sandbox.run_id = r.run_id AND sandbox.org_id IS NULL;

UPDATE run_command SET
    org_id = r.org_id,
    ws_id = r.ws_id,
    member_id = r.member_id
FROM runs r WHERE run_command.run_id = r.run_id AND run_command.org_id IS NULL;

UPDATE sandbox_exec SET
    org_id = s.org_id,
    ws_id = s.ws_id,
    member_id = s.member_id
FROM sandbox s WHERE sandbox_exec.run_id = s.run_id AND sandbox_exec.org_id IS NULL;

-- 3) Backfill truth ledger
UPDATE steps SET
    org_id = r.org_id,
    ws_id = r.ws_id,
    member_id = r.member_id
FROM runs r WHERE steps.run_id = r.run_id AND steps.org_id IS NULL;

UPDATE links SET
    org_id = r.org_id,
    ws_id = r.ws_id,
    member_id = r.member_id
FROM runs r WHERE links.run_id = r.run_id AND links.org_id IS NULL;

UPDATE sessions_index SET
    org_id = r.org_id,
    ws_id = r.ws_id,
    member_id = r.member_id
FROM runs r WHERE sessions_index.run_id = r.run_id AND sessions_index.org_id IS NULL;

-- 4) Backfill docs and their children
-- Since docs are CAS, we'll assign them to the default workspace if they are unscoped.
UPDATE docs SET
    org_id = '00000000-0000-0000-0000-000000000001',
    ws_id = '00000000-0000-0000-0000-000000000002'
WHERE org_id IS NULL;

UPDATE parses SET
    org_id = d.org_id,
    ws_id = d.ws_id,
    member_id = d.member_id
FROM docs d WHERE parses.doc_sha = d.doc_sha AND parses.org_id IS NULL;

UPDATE chunks SET
    org_id = d.org_id,
    ws_id = d.ws_id,
    member_id = d.member_id
FROM parses p
JOIN docs d ON d.doc_sha = p.doc_sha
WHERE chunks.parse_id = p.parse_id AND chunks.org_id IS NULL;

UPDATE spans SET
    org_id = d.org_id,
    ws_id = d.ws_id,
    member_id = d.member_id
FROM chunks c
JOIN parses p ON p.parse_id = c.parse_id
JOIN docs d ON d.doc_sha = p.doc_sha
WHERE spans.chunk_id = c.chunk_id AND spans.org_id IS NULL;

-- 5) Finalize constraints and add indexes
ALTER TABLE runs ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE runs ALTER COLUMN ws_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS runs_tenancy_idx ON runs (org_id, ws_id, member_id);
CREATE INDEX IF NOT EXISTS events_tenancy_idx ON events (org_id, ws_id, member_id);
CREATE INDEX IF NOT EXISTS docs_tenancy_idx ON docs (org_id, ws_id, member_id);
CREATE INDEX IF NOT EXISTS steps_tenancy_idx ON steps (org_id, ws_id, member_id);
