---
paths: ["**/*"]
---
# Global Invariants
- Runner: `mise` ONLY. `MISE_EXPERIMENTAL=1`. Zero npm/make/shell orchestration.
- Config: `fnox` ONLY. `.env*` BANNED. Hydrated via `bootstrap:secrets`.
- Repro: `mise.lock` strictness. State: Immutable CAS. TS determinism > opaque shell scripts.
- PI Auth: `PI_RPC_STRICT_REAL=1` needs host `~/.pi` writable. Blank PI output is valid.
- Guard: `check:lesson-guard` enforces rules. Rule deltas MANDATORY for operation script edits. CI=range; local=tree+staged.