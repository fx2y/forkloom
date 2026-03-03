# forkloom AGENT Policy
**Law**: `mise`+`fnox` ONLY. NO `.env`/`make`/`npm`. `MISE_EXPERIMENTAL=1`.

## 1. Arch & Boundaries
- **API**: Schema=Truth. `/runs/:id/*` ONLY. BANNED: Top-level nouns (`/docs`, `/skills`), `Sandbox*` leaks. `v0` frozen. 5-noun freeze enforced.
- **Compute/Skill**: `skill_exec` via sandbox `RunnerBackend` ONLY. NO host bash. L3 reads jailed (`realpath`/`lstat`). L1 registry reads prefix bytes ONLY.
- **Logic**: Pure TS modules. Core logic isolated from HTTP/shell. Single hash/canonical source in `@forkloom/shared`.

## 2. Durability & State
- **Storage**: CAS is absolute. Reserve-first SQL -> store blob -> rollback on fail. 1 storage substrate.
- **DBOS**: Replay determinism law. Step outputs=JSON. 1 JSON `recordStepLedger` row per step. NO local handles.
- **UI**: 100% `innerHTML`-free (text-node ONLY). Infinite SSE (client cursor). Reducer-owned state (strict graph derivation).

## 3. Dev, Ops & Verification
- **DAG**: `.mise.toml` is absolute. Lane not in DAG = non-existent. Non-exec scripts in `mise-tasks/`.
- **Probes**: Bounded stability polling (`wait_for_url`/`waitFor`) MANDATORY. NO single-shot curl.
- **Gates**: `ci:force` sequential. `check:lesson-guard` demands rule deltas. NO manual UI-only checks.
- **Proofs**: DBOS crash demands real SIGKILL+recovery (0 hash/row diffs). Close latch MUST be non-vacuous (booleans+reqs). Packs need dynamic-output proofs.