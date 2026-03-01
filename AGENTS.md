# forkloom AGENT policy
Doctrine: `mise` only. `fnox` secrets. NO `.env`. `MISE_EXPERIMENTAL=1`.
Model: `AGENTS.md` + `.codex/rules/*.md`. Sync enforced via `check:lesson-guard`.

## Architecture & Code Quality
- **Runner**: Explicit `.mise.toml` DAG. Zero npm/shell orchestration.
- **Contracts**: TRUTH=Schema. v0 frozen, v1 additive. Public surface is run-owned (`/runs`); `Sandbox*` nouns banned to stop scope creep. `/runs/:id/truth` is the ONLY canonical audit payload.
- **Compute**: Docker ONLY in `apps/api/src/sandbox`. Host paths = container absolute paths.
- **Durability (DBOS)**: Replay safety > convenience. Step outputs MUST serialize to JSON. No process-local handles across steps. Repo txn seam `recordStepLedger` must be atomic.
- **Storage**: Reserve-first SQL -> store CAS blob -> rollback on fail.
- **UI**: Zero `innerHTML`. Text nodes ONLY. Infinite SSE (client manages reconnect cursor). State strictly derived from durable graph streams; no heuristic edge invention.
- **Gates**: Merge demands SQL checklist (steps/links/artifacts/session/payload must exist) + golden replay-truth proof + scope-guard scans.

## Dev Loop & Ops
- **Init**: `mise trust && mise install && mise prep && mise run bootstrap`
- **Verify**: `ci:force` (check -> int:force -> golden -> fault -> sys -> bench).
- **Live**: API mounted but NO hot-reload. MUST restart `api` & block on `/health` after TS edits before live proofs. Aggregate `--force` banned; use explicit nested tasks.
- **Triage**: Ops SQL (`test:int:ops-sql`) first for RCA before re-running flows.