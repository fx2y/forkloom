---
paths: ["**/*"]
---
# Global Doctrine
- **Tools**: `mise`+`fnox` ONLY. `.env`/`make`/`npm` scripts BANNED.
- **Enforcement**: `check:lesson-guard` demands policy deltas. `check:scope-guard` blocks scope drift.
- **Determinism**: Pure TS > shell. Immutable CAS. Output captures `out/*` delta ONLY. Deterministic first-wins (scope+order) on collisions.
- **Live-First**: Strict-real, no-mock, e2e-operator. Mock claims REJECTED.