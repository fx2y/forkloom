-- 011_tenancy_rls.sql
-- FORCE-RLS baseline with one strict policy per tenant table.

-- Extend tenant tags to step payloads so /truth reads are RLS-protected too.
ALTER TABLE step_payloads ADD COLUMN IF NOT EXISTS org_id uuid REFERENCES org(org_id);
ALTER TABLE step_payloads ADD COLUMN IF NOT EXISTS ws_id uuid REFERENCES workspace(ws_id);
ALTER TABLE step_payloads ADD COLUMN IF NOT EXISTS member_id uuid REFERENCES member(member_id);

UPDATE step_payloads sp
SET org_id = r.org_id,
    ws_id = r.ws_id,
    member_id = r.member_id
FROM steps s
JOIN runs r ON r.run_id = s.run_id
WHERE sp.run_id = s.run_id
  AND sp.step_name = s.step_name
  AND sp.attempt = s.attempt
  AND sp.org_id IS NULL;

CREATE INDEX IF NOT EXISTS step_payloads_tenancy_idx
  ON step_payloads(org_id, ws_id, member_id);

-- Ensure inserts without explicit tenant columns inherit txn-local scope context.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'runs',
    'events',
    'run_artifacts',
    'sandbox',
    'run_command',
    'sandbox_exec',
    'steps',
    'links',
    'sessions_index',
    'step_payloads',
    'docs',
    'parses',
    'chunks',
    'spans',
    'object_kv'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN org_id SET DEFAULT nullif(current_setting(''app.org_id'', true), '''')::uuid',
      t
    );
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN ws_id SET DEFAULT nullif(current_setting(''app.ws_id'', true), '''')::uuid',
      t
    );
    EXECUTE format(
      'ALTER TABLE %I ALTER COLUMN member_id SET DEFAULT nullif(current_setting(''app.member_id'', true), '''')::uuid',
      t
    );
  END LOOP;
END $$;

DO $$
DECLARE
  t text;
  read_expr text := $policy$
    org_id = nullif(current_setting('app.org_id', true), '')::uuid
    AND (
      ws_id IS NULL
      OR ws_id = nullif(current_setting('app.ws_id', true), '')::uuid
    )
    AND (
      member_id IS NULL
      OR member_id = nullif(current_setting('app.member_id', true), '')::uuid
    )
  $policy$;
  write_expr text := $policy$
    org_id = nullif(current_setting('app.org_id', true), '')::uuid
    AND (
      (ws_id IS NULL AND nullif(current_setting('app.ws_id', true), '') IS NULL)
      OR ws_id = nullif(current_setting('app.ws_id', true), '')::uuid
    )
    AND (
      (member_id IS NULL AND nullif(current_setting('app.member_id', true), '') IS NULL)
      OR member_id = nullif(current_setting('app.member_id', true), '')::uuid
    )
  $policy$;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'runs',
    'events',
    'run_artifacts',
    'sandbox',
    'run_command',
    'sandbox_exec',
    'steps',
    'links',
    'sessions_index',
    'step_payloads',
    'docs',
    'parses',
    'chunks',
    'spans',
    'object_kv'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING (%s) WITH CHECK (%s)',
      t,
      read_expr,
      write_expr
    );
  END LOOP;
END $$;
