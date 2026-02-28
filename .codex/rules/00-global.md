---
paths: ["**/*"]
---

# Global Invariants

- **Runner:** `mise` only. No shell/npm orchestration. `MISE_EXPERIMENTAL=1` required.
- **Secrets:** `fnox` only. `.env` strictly banned. Hydrate via `bootstrap:secrets`.
- **Repro:** `mise.lock` + `MISE_LOCKED=1`. Refresh via `mise lock --platform`.
- **Logic:** Pure TS > shell. Opaque shell logic is technical debt.
- **Determinism:** Identical input => identical hash. Strip volatile keys.
- **Lessons:** Every PR adds invariant (`rules/*.md`) or test. `check:lesson-guard` enforces.
- **Health:** Ready = probe all deps + hard-fail diagnostic. Reachability > 2xx.
- **PI:** `PI_RPC_STRICT_REAL=1` requires local `~/.pi` auth/settings. No-mock is north-star.
