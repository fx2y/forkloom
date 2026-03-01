---
paths: ["**/*"]
---
# Global
- **Runner**: `mise` ONLY. Zero npm/make orchestration.
- **Config**: `fnox` ONLY. `.env*` BANNED. Sensitive keys must be `fnox` `age`-provider backed. Hydrate via `bootstrap:secrets`.
- **State**: Immutable CAS. TS determinism over opaque shell scripts.
- **Auth**: `PI_RPC_STRICT_REAL=1` needs writable host `~/.pi`. Blank PI output valid.
- **Guards**: `check:lesson-guard` enforces rules on code change. Rule deltas MANDATORY for operation script edits.
