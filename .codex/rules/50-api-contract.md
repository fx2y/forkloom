---
paths: ["apps/api/**", "contracts/**", "packages/contracts/**"]
---
# API/Contract
- **Schema**: TRUTH. v0 frozen, v1 additive (`Run*`).
- **Artifacts**: Reserve-first SQL -> CAS store -> rollback on fail. Exact-byte. Overwrite=409.
- **Compute**: `apps/api/src/sandbox` ONLY. Raw docker BANNED elsewhere. Host mounts = container absolutes.
- **Orchestration**: `run:` prefix for Sandbox dispatch. Replay stub R0 skips live side-effects.
- **Public Surface**: `/runs/:runId/truth` is single canonical audit payload. `Sandbox*` nouns/routes strictly banned from public edge.
- **DBOS**: `createPoolCloseOnce()` prevents compose restart collapse. `recordStepLedger` is atomic repo txn.