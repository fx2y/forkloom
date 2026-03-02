---
paths: ["apps/api/**", "contracts/**", "packages/contracts/**"]
---
# API & Contract Law
- **Namespace**: `/runs/:id/*` ONLY. Top-level nouns (`/docs`) and `Sandbox*` leaks BANNED.
- **Schema=Truth**: `v0` frozen, `v1` additive. Typegen MUST be newline-stable.
- **Storage**: CAS reserve-first SQL -> store blob -> rollback on fail.
- **Durability**: DBOS step outputs MUST be JSON. NO cross-step process-local handles (e.g., PiSessionPort). `recordStepLedger` MUST be atomic.
- **ID Law**: Hashes (`docSha`, `chunkId`) MUST use centralized generators. Normalize BEFORE hashing.