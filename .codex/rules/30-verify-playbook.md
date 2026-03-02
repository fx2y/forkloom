---
paths: ["tests/**", "scripts/harness/**", "fixtures/**", "schema/**", "docker-compose.yml"]
---
# Verification & Fault
- **Pipeline**: `check:*` -> `test:int:*` -> `golden:*` -> `fault:*` -> `test:sys` -> `bench:*`.
- **Fault Proofs**: MUST use real DBOS workflows. SIGKILL -> recover. Requires ZERO hash/row diffs. Synthetic drills are NON-PROOF.
- **Checklists**: MUST be non-vacuous. Fail on `no_done_parses` and missing done-state invariants. Absence of errors != green.
- **Triage**: Run ops SQL (`test:int:ops-sql`) BEFORE re-running flows.