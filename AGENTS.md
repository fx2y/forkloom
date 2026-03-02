# forkloom AGENT Policy
**Doctrine**: `mise` + `fnox` ONLY. NO `.env`. NO `make`/`npm` scripts. `MISE_EXPERIMENTAL=1`.

## 1. Architecture & Code Law
- **Orchestration**: `.mise.toml` DAG is absolute law. If a lane isn't in the DAG, it doesn't exist.
- **API Surface**: Schema = Truth. `/runs/:id/*` ONLY. BANNED: Top-level nouns (`/docs`, `/artifacts`), `Sandbox*` leaks. `/runs/:id/truth` is the ONLY canonical audit payload.
- **Compute**: Docker ONLY in `apps/api/src/sandbox`. Host paths = container absolutes.
- **Durability (DBOS)**: Replay determinism is absolute. Step outputs MUST serialize to JSON. No process-local handles across steps. Repo txn seam `recordStepLedger` MUST be atomic.
- **Storage**: CAS is law. Reserve-first SQL -> store CAS blob -> rollback on fail. One storage substrate. `artifact_alias` is a logical key, NOT a blob namespace.
- **ID Law**: Centralize hash generators (e.g., `docSha`, `chunkId`). Normalize BEFORE hashing. Ad hoc hash assembly is a regression.
- **UI**: ZERO `innerHTML` (XSS-safe). Infinite SSE (client owns reconnect cursor). Strict state derivation.

## 2. Dev & Ops Loop
- **Init**: `mise trust && mise install && mise prep && mise run bootstrap`
- **Verify DAG**: `ci:force` = `check` -> `int` -> `golden` -> `fault` -> `sys` -> `bench`.
- **Live Edits**: NO hot-reload. Edit TS -> restart `api` -> block on `/health` -> run proofs.
- **Fault/Crash**: DBOS crash proofs MUST execute real SIGKILL + DBOS recovery with ZERO hash/row diffs. Synthetic drills are NON-PROOF.
- **Triage**: Ops SQL (`test:int:ops-sql`) FIRST for RCA.
- **Gates**: Code changes without tests/rule deltas fail `check:lesson-guard`. Merge demands non-vacuous SQL checklists + golden replay proofs.