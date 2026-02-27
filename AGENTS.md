# forkloom AGENT policy (living spec index)

Scope: repo memory root. Keep terse; push detail to `.codex/rules/*`.

Model:
- One tracked repo memory root: `AGENTS.md` (this file).
- Modular detail allowed only in `.codex/rules/*.md` (imported below).
- Private local prefs in `AGENTS.local.md` only (gitignored); never required for CI.

Hard invariants:
- Orchestrator=`mise` only (`C1`,`D1`,`R3`); no `make/just/npm run` as DAG runner.
- Secrets=`fnox` only (`C2`,`D2`); `.env*` forbidden.
- Repro=`mise.lock`+locked install (`C3`); refresh via `mise lock --platform ...`.
- `MISE_EXPERIMENTAL=1` required for fast deps/watch (`C4`).
- Durability/once semantics are mandatory: SQL unique guard + DBOS crash/recover live proof (`D3`,`D8`,`G4`).
- PI gate must execute real RPC protocol; default fallback is local OpenAI-compatible mock for deterministic CI (`D7`,`G5`).
- CI force gate must run phases sequentially, not multi-arg single run (`D6`,`A5`).

Entrypoints (canonical):
- Bootstrap: `mise trust && mise install && MISE_EXPERIMENTAL=1 mise prep && MISE_EXPERIMENTAL=1 mise run bootstrap`
- Dev loop: `MISE_EXPERIMENTAL=1 mise watch check test:int golden`
- Ordered verify: `bootstrap:doctor -> check:contract -> check:unit -> test:int -> test:sys -> golden -> fault -> bench`
- Full refresh gates: `MISE_EXPERIMENTAL=1 mise run ci:force`

Living-spec compounding:
- Any new bug/regression/PR pattern MUST add at least one: invariant (`AGENTS.md`/rule) or regression test; preferred=both.
- Behavior change without test/rule delta requires explicit rationale in commit/PR notes (`NO_NEW_INVARIANT=<why>`).
- CI policy (required): run a lesson-guard check; fail when `src/**|scripts/**|mise-tasks/**|schema/**|fixtures/**|.mise.toml|docker-compose.yml` changed and neither `tests/**` nor `AGENTS.md|.codex/rules/**` changed.

Imports:
@.codex/rules/00-global.md
@.codex/rules/10-ts-harness.md
@.codex/rules/20-mise-dag.md
@.codex/rules/30-verify-playbook.md
@.codex/rules/40-ui-state.md
