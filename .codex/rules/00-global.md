---
paths: ["**/*"]
---
# Global Invariants
- Runner: `mise` ONLY. `MISE_EXPERIMENTAL=1`. Zero npm/shell orchestration.
- Config: `fnox` ONLY. `.env*` BANNED. Hydrate via `bootstrap:secrets`.
- Repro: `mise.lock` strictness. `MISE_LOCKED=1`. Refresh via `mise lock --platform`.
- State: Immutable CAS. Append-only events. Deterministic TS > opaque shell.
- PI Auth: `PI_RPC_STRICT_REAL=1` requires host `~/.pi` state. Writable mirrored HOME.
- Gate: `check:lesson-guard` blocks unproven changes. CI mode evaluates range; local evaluates tree+staged.