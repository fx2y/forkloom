-- Operator SQL Pack: Truth Substrate & Ledger Drift Triage
-- Usage: Execute via `pnpm exec tsx scripts/harness/run-ops-sql-pack.ts <runId>`
-- Doctrine: Ops-first RCA. Never rerun a failing workflow until you locate the step drift here.

-- 1. Verify Target Run Freshness
SELECT r.run_id, r.status, r.created_at, r.updated_at
FROM runs r
WHERE r.run_id = $1;

-- 2. Hunt Missing Causal Payload Substrate (C112 Law)
-- Identifies ended steps that failed to persist a replay payload. Merge blocker.
SELECT s.run_id, s.step_name, s.attempt, s.out_hash, s.ended_at
FROM steps s
LEFT JOIN step_payloads p ON s.run_id = p.run_id AND s.step_name = p.step_name AND s.attempt = p.attempt
WHERE p.out_payload IS NULL AND s.ended_at IS NOT NULL;

-- 3. Dead Command Trace (C111 Law)
-- Ensures dead-lettered commands leave an auditable ledger footprint.
SELECT s.run_id, s.step_name, s.attempt, s.in_hash, s.out_hash
FROM steps s
WHERE s.run_id = $1 AND s.step_name IN ('run_command_dead', 'run_command_requeue')
ORDER BY s.created_at DESC;

-- 4. Session Index Leaf Integrity & Dangling Roots
SELECT i.run_id, i.session_path, i.leaf_id, i.root_id, i.entry_count
FROM sessions_index i
WHERE i.run_id = $1 AND (i.leaf_id IS NULL OR i.root_id IS NULL);

-- 5. Artifact Provenance Edge Analysis
-- Extracts the raw edges that hydrate the UI drawer's `provenanceByArtifact`.
SELECT l.run_id, l.step_name, l.artifact_sha, l.session_entry_ids, l.note
FROM links l
WHERE l.run_id = $1 AND l.artifact_sha IS NOT NULL;
