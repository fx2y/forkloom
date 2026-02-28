---
paths: ["apps/api/**", "contracts/**", "packages/contracts/**"]
---
# API & Contract Rules
- Contract: Schema=TRUTH. v0 frozen (5-noun), v1 additive (`Run*`).
- Artifacts: Reserve-first SQL -> store write -> rollback on fail. Exact-byte. Overwrite=409.
- Sandbox: Isolation in `apps/api/src/sandbox` ONLY. Raw docker BANNED elsewhere. Host mount paths MUST match container absolute paths.
- Run Launch: Idempotent `runs.run_id` = workflowID. Sandbox dispatch MUST use `run:` prefix.
- DBOS Teardown: `createPoolCloseOnce()` collapse promise protects DB under compose restarts.