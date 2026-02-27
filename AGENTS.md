# forkloom AGENT policy (living spec index)

Scope: repo memory root. Keep terse; push detail to `.codex/rules/*`.
Model: `AGENTS.md` (root) + `.codex/rules/*.md` (modular).

## Doctrine (Hard Invariants)
- **Runner:** `mise` only. No `make/just/npm` orchestration. `MISE_EXPERIMENTAL=1` mandatory.
- **Secrets:** `fnox` only. `.env*` strictly banned (deep scan). Hydrate via `bootstrap:secrets`.
- **Repro:** `mise.lock` + `MISE_LOCKED=1`. Refresh platform URLs via `mise lock --platform ...`.
- **Durability:** Dual-layer proof: SQL unique-idempotency + DBOS crash/recover runtime trace.
- **Artifacts:** CAS immutable. Reserve-first (SQL) -> write. Overwrite=409. Meta=namespaced lowercase.
- **Contracts:** Schema source-of-truth. Drift-check (schema vs typegen vs examples) + noun-ban (5-noun freeze).
- **Protocol:** PI gate must run real RPC mock/live. Local mock default for CI; `PI_RPC_STRICT_REAL=1` for live.
- **Compounding:** Every bug/PR must add invariant (rule) or test. `check:lesson-guard` enforces this.

## Entrypoints (Canonical)
- **Init:** `mise trust && mise install && MISE_EXPERIMENTAL=1 mise prep && MISE_EXPERIMENTAL=1 mise run bootstrap`
- **Loop:** `MISE_EXPERIMENTAL=1 mise watch check test:int golden`
- **Ops:** `mise run svc` (up+health), `svc:logs`, `svc:reset` (purge+unroot)
- **Verify:** `bootstrap:doctor -> check:* -> test:int:* -> golden:* -> fault:* -> test:sys -> bench:*`
- **Gate:** `MISE_EXPERIMENTAL=1 mise run ci:force` (sequential phase force)

Imports:
@.codex/rules/00-global.md
@.codex/rules/10-ts-harness.md
@.codex/rules/20-mise-dag.md
@.codex/rules/30-verify-playbook.md
@.codex/rules/40-ui-state.md
@.codex/rules/50-api-contract.md
