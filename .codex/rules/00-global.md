---
paths: ["**/*"]
---
# Global Doctrine
- **Tools**: `mise` + `fnox` ONLY. `.env` and `npm/make` scripts BANNED.
- **Enforcement**: `check:lesson-guard` requires rule deltas for logic changes. `check:scope-guard` blocks out-of-scope edits.
- **Determinism**: Immutable CAS + pure TS logic > opaque shell.