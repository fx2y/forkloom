---
paths: ["**/*"]
---
# Global Doctrine
- **Tools**: `mise`+`fnox` ONLY. `.env`/`make`/`npm` scripts BANNED.
- **Enforcement**: `check:lesson-guard` demands policy deltas. `check:scope-guard` blocks scope drift.
- **Determinism**: Pure TS > shell. Immutable CAS. Output captures `out/*` delta ONLY (exclude stale).
- **Collision**: Deterministic first-wins (scope+order).