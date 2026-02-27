---
paths:
  - "**/*"
---

# Global Invariants

- **Runner:** `mise` only. `package.json` scripts execute tools, never order/orchestrate DAG.
- **Secrets:** `fnox` only. `.env*` forbidden repo-wide (deep scan); exclude `.git/node_modules` ONLY.
- **Repro:** `mise.lock` mandatory; CI runs `MISE_LOCKED=1`. Refresh via `mise lock --platform ...`.
- **Logic:** Prefer pure TS + thin shell. Opaque shell logic is debt.
- **Determinism:** Identical input => identical hashes/diffs. Strip volatile keys in canon.
- **Lessons:** Every incident/PR yields rule (this folder) or test update. `check:lesson-guard` enforced.
- **Health:** Ready = probe all deps + hard-fail diagnostic. Reachability (curl -sS) > 2xx for auth roots.
