# Durability & Crash Recovery Patterns

## SQL Idempotency (D3)
Primary durability mechanism is DB-level uniqueness checks.

### Pattern: Insert-on-Conflict
```sql
INSERT INTO artifact_metadata (id, content, hash)
VALUES ($1, $2, $3)
ON CONFLICT (hash) DO UPDATE SET updated_at = NOW()
RETURNING id;
```

## DBOS-Ready Logic (D8)
Workflows are structured into discrete `steps`.

### Crash/Recovery Integration Test
`test:int:dbos-runtime` simulates process failure halfway through a multi-step operation.

1.  **Step 1:** Initial commit.
2.  **SIGNAL KILL:** Kill the runtime process.
3.  **RESUME:** Start process.
4.  **RECOVERY:** System must skip Step 1 and complete Step 2 using the checkpoint.

```bash
# Snapshot of fault injection in test:int:dbos-runtime
mise run svc:up
RUN_ID=$(submit_workflow)
kill -9 $(pgrep forkloom-svc)
mise run svc:up
verify_completion $RUN_ID
```

## OCR Deterministic Post-Process (D4)
OCR can be flaky/heavy. We enforce a contract on the *output* (Markdown/JSON/Hash) to ensure downstream consumers are decoupled from specific OCR engine performance variability.
- **Contract:** If same hash, must produce identical Markdown.
- **Verification:** `check:contract` validates schema compliance of OCR output JSON.
