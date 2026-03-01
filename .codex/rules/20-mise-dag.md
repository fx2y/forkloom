---
paths: [".mise.toml", "mise-tasks/**", "scripts/lib/**/*.sh", "README.md"]
---
# Mise/DAG Rules
- DAG: Explicit `.mise.toml`. Cache via `write_mark`. Scripts are non-exec in `mise-tasks/`.
- Teardown: `svc:down`/`reset` MUST use `--profile worker`. Reset MUST gc `sbx-*` orphan containers before volume drops.
- Dev Loop: `svc:up` runs `tsx`. NO hot-reload. MUST restart `api` & wait `/health` after TS edits before live proof.
- Force: Aggregate `--force` is weak. Nested explicit tasks (`test:int:force`, `test:sys`, `ci:force`) MANDATORY.
- C4 DAG: `test:int:truth-checklist`, `golden:truth`, and `test:int:ops-sql` are first-class nodes in force-chain; ad hoc one-off scripts are non-gates.
