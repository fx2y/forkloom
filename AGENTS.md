# forkloom AGENT policy (v1.0.0)
Doctrine: `mise` only. `fnox` secrets. `.env` banned. `MISE_EXPERIMENTAL=1`.
Model: `AGENTS.md` + `.codex/rules/*.md`. `check:lesson-guard` enforces rule-sync.

## Architecture
- Runner: `mise`. No npm/shell orchestration.
- Secrets: `fnox` profiles. `bootstrap:secrets`.
- Contracts: Schema is truth. v0 frozen (5-noun), v1 additive.
- PI: RPC mock default; `PI_RPC_STRICT_REAL=1` + `~/.pi` for live.
- Artifacts: Immutable CAS. Overwrite=409. Meta=lowercase-namespaced.

## Entrypoints
- Init: `mise trust && mise install && mise prep && mise run bootstrap`
- Loop: `mise watch check test:int golden`
- Ops: `mise run svc` (up/health/logs/reset)
- Verify: `ci:force` (sequential: check->test:int->golden->fault->bench)

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