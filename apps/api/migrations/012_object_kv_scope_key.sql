-- 012_object_kv_scope_key.sql
-- Keep object_kv tri-shape nullable while preserving deterministic scope-key uniqueness.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'object_kv_pkey'
      AND conrelid = 'object_kv'::regclass
  ) THEN
    ALTER TABLE object_kv DROP CONSTRAINT object_kv_pkey;
  END IF;
END $$;

ALTER TABLE object_kv ALTER COLUMN ws_id DROP NOT NULL;
ALTER TABLE object_kv ALTER COLUMN member_id DROP NOT NULL;

WITH ranked AS (
  SELECT
    ctid AS row_ctid,
    row_number() OVER (
      PARTITION BY kind, key, org_id, ws_id, member_id
      ORDER BY updated_at DESC, ctid DESC
    ) AS rn
  FROM object_kv
)
DELETE FROM object_kv ok
USING ranked r
WHERE ok.ctid = r.row_ctid
  AND r.rn > 1;

ALTER TABLE object_kv DROP CONSTRAINT IF EXISTS object_kv_scope_key_uq;
ALTER TABLE object_kv
  ADD CONSTRAINT object_kv_scope_key_uq
  UNIQUE NULLS NOT DISTINCT (kind, key, org_id, ws_id, member_id);
