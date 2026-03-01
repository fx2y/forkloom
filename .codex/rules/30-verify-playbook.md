---
paths: ["tests/**", "scripts/harness/**", "fixtures/**", "schema/**", "docker-compose.yml"]
---
# Verify/Debug
- **Flow**: `check:*` -> `test:int:*` -> `golden:*` -> `fault:*` -> `test:sys` -> `bench:*`.
- **Fault**: Post-fault smoke MUST block on `/health` 200.
- **DBOS**: Step outputs MUST be JSON serializable. No `PiSessionPort` across steps.
- **C4 Proofs**: `test:int:truth-checklist` hard-fails on missing hashes/links/artifacts/payloads. `golden:truth` asserts replay sha-set.
- **Triage**: Ops SQL (`test:int:ops-sql`) first for RCA. Live runs rejected if no replayable payloads.
- **Recovery**: Delete `.env*`, `bootstrap:secrets`. Stale workers with claim/lease mismatch hard-fail.
- **Doc OCR Gate**: `test:int:doc-ocr` must execute `doc-status` + `doc-zai-client` + `doc-workflow` unit proofs and emit CY5/CY6 scan artifacts under `.cache/spec07/`.
