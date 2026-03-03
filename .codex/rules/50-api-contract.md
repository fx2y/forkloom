---
paths: ["apps/api/**", "contracts/**", "packages/contracts/**", "extensions/**"]
---
# API & Contract Law
- **Namespace**: `/runs/:id/*` ONLY. BANNED: `/extensions`, `/packages`, `/themes`, `/reload`, `/skills`, `/docs`.
- **Extensions**: API floor FROZEN (`registerTool/registerCommand/registerProvider/appendEntry/on/hasUI/ui`). Reload is transactional (unload->clear->load) + rollback. Provider overrides extension-owned. Flagships = standard extensions.
- **Skills**: `/skill:*` text-only in prompt/followUp/steer. `v0` stays thin manifest. `available_skills` XML is escaped L1 projection.
- **Jail**: L1 registry reads prefix bytes ONLY. L3 reads use `read-skill-file` with `realpath`/`lstat` jail.
- **Sandbox**: `skill_exec` via `RunnerBackend` ONLY. NO host bash.
- **Storage**: CAS reserve-first SQL -> blob store -> rollback. 1 JSON `recordStepLedger` row/step. NO local handles.