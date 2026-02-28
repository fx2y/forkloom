# forkloom AGENT policy (v1.0.0)

Doctrine: `mise` only. `fnox` secrets. `.env` banned. `MISE_EXPERIMENTAL=1` mandatory.
Model: `AGENTS.md` + `.codex/rules/*.md`. `check:lesson-guard` enforces rule-sync.

## Doctrine
- **Runner:** `mise`. No orchestration in `package.json`/shell.
- **Secrets:** `fnox` profiles. Hydrate via `bootstrap:secrets`.
- **Durability:** SQL idempotency + DBOS `runStep` trace. Reserve-first writes.
- **Contracts:** Schema source-of-truth. 5-noun freeze. v1 isolation.
- **PI:** RPC mock default; `PI_RPC_STRICT_REAL=1` for live.
- **Artifacts:** Immutable CAS. Overwrite=409. Meta=lowercase namespaced.

## Entrypoints
- **Init:** `mise trust && mise install && mise prep && mise run bootstrap`
- **Loop:** `mise watch check test:int golden`
- **Ops:** `mise run svc` (up/health/logs/reset)
- **Verify:** `ci:force` (sequential: check -> test:int -> golden -> fault -> bench)

Imports:
@.codex/rules/00-global.md
@.codex/rules/10-ts-harness.md
@.codex/rules/20-mise-dag.md
@.codex/rules/30-verify-playbook.md
@.codex/rules/40-ui-state.md
@.codex/rules/50-api-contract.md
