---
paths: ["apps/api/**", "contracts/**", "packages/contracts/**"]
---
# API & Contract Law
- **Namespace**: `/runs/:id/*` ONLY. BANNED: `/skills`, `/docs`, top-level nouns. 5-noun freeze.
- **Skills**: `/skill:*` text-only in prompt/followUp/steer. `v0` stays thin manifest. `available_skills` XML is escaped L1 projection.
- **Jail**: L1 registry reads prefix bytes ONLY. L3 reads use `read-skill-file` with `realpath`/`lstat` jail.
- **Sandbox**: `skill_exec` via `RunnerBackend` ONLY. NO host bash.
- **Storage**: CAS reserve-first SQL -> blob store -> rollback. Meta validated at HTTP boundary.
- **DBOS**: 1 JSON `recordStepLedger` row/step. NO process-local handles across steps.