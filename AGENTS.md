# forkloom AGENT policy (v1.0.0)

Doctrine: `mise` only. `fnox` secrets. `.env` banned. `MISE_EXPERIMENTAL=1`.
Model: `AGENTS.md` + `.codex/rules/*.md`. `check:lesson-guard` enforces rule-sync on code change.

## Architecture & Code Quality
- **Runner:** `mise`. Zero npm/shell orchestration. Explicit DAG `.mise.toml`.
- **Contracts:** Schema=TRUTH. v0 frozen, v1 additive. Parser/types strictly follow schema.
- **Compute:** `apps/api/src/sandbox` ONLY. Raw docker execution banned outside this slice.
- **Durability (DBOS):** Replay safety > convenience. Step outputs MUST be JSON serializable. Process-local handles banned across steps.
- **Storage:** Reserve-first SQL -> store write -> rollback. Immutable CAS.
- **UI:** Zero `innerHTML`. Text-node DOM only. Truth strictly derived from durable event/projection streams, no runtime guesses. Infinite SSE, client manages disconnect/reconnect.

## Entrypoints
- **Init:** `mise trust && mise install && mise prep && mise run bootstrap`
- **Loop:** `mise watch check test:int golden`
- **Ops:** `mise run svc` (up/health/logs/reset). `reset` drops `sbx-*` orphan containers.
- **Verify:** `ci:force` (check -> test:int:force -> golden -> fault -> test:sys -> bench). Wait `/health` after fault.

## Live Loop Guidelines
- NO hot-reload for `api` container. MUST restart `api` & wait `/health` after TS edits before live proofs.
- `PI_RPC_STRICT_REAL=1` requires host `~/.pi/agent/` writable auth state.
- Aggregate `--force` is insufficient; use explicit nested tasks.

Imports:
<!-- Imported from: .codex/rules/00-global.md -->
@.codex/rules/00-global.md
<!-- Imported from: .codex/rules/10-ts-harness.md -->
@.codex/rules/10-ts-harness.md
<!-- Imported from: .codex/rules/20-mise-dag.md -->
@.codex/rules/20-mise-dag.md
<!-- Imported from: .codex/rules/30-verify-playbook.md -->
@.codex/rules/30-verify-playbook.md
<!-- Imported from: .codex/rules/40-ui-state.md -->
@.codex/rules/40-ui-state.md
<!-- Imported from: .codex/rules/50-api-contract.md -->
@.codex/rules/50-api-contract.md