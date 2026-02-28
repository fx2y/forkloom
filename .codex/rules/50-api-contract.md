---
paths: ["apps/api/**", "contracts/**", "packages/contracts/**"]
---
# API & Contract Rules
- Artifacts: Exact-byte hash. Reserve-first SQL, store write, rollback on fail. Overwrite=409.
- Contracts: Schema is TRUTH. v0 frozen (5-noun), v1 additive. `validate.ts` unifies both.
- Run Launch: Idempotent POST `runs.run_id = workflowID`. Launch failure leaves retryable row.
- Durability (DBOS): SQL idempotency. API step proof requires unique bytes. Replay-safe steps ONLY.
- Teardown: `createPoolCloseOnce()` protects DB/repos during signals/restarts.
- Workers: Split is doc-only seam. In-process queues run behind launcher boundary.