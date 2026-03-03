---
paths: ["tests/**", "scripts/harness/**", "fixtures/**", "schema/**", "docker-compose.yml"]
---
# Verification & Fault
- **Flow**: `check:*`->`test:int:*`->`golden:*`->`fault:*`->`test:sys`->`bench:*`.
- **Fault**: Real DBOS crash/recovery ONLY. 0 hash/row diffs. Synthetic drills REJECTED.
- **Latch**: Close MUST be non-vacuous (req miss 0, validate/pack/live booleans 1). Absence of error != green.
- **Proofs**: NO manual UI signoffs. Packs demand dynamic-output proofs. Real RPC proof stays in `test:int:pi-rpc-live`.
- **Triage**: Ops SQL (`test:int:ops-sql`) ALWAYS FIRST.