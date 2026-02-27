---
paths:
  - "**/*"
---

# Global invariants

- Runner: `mise` only. `package.json` scripts may execute tools, never orchestrate pipeline order/deps/cache.
- Secrets: `fnox` only. `.env*` is policy violation; secret checks belong in `bootstrap:secrets`.
- Repro: commits touching tools/tasks must keep `mise.lock` coherent; CI runs with `MISE_LOCKED=1`.
- Determinism first: identical input => identical artifacts/hashes/diffs.
- Prefer pure TS core + thin shell wrappers; opaque shell-only logic is tech debt.
- New external dependency requires lock, health probe, and failure recipe.
- Additive rule: every incident yields test and/or invariant text update.
