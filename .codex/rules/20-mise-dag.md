---
paths: [".mise.toml", "mise-tasks/**", "scripts/lib/**/*.sh", "README.md"]
---
# Mise/DAG
- **DAG**: Explicit `.mise.toml`. Cache via `write_mark`. Scripts under `mise-tasks/` non-exec.
- **Teardown**: `svc:down`/`reset` MUST use `--profile worker`. Drop orphan `sbx-*` containers before volumes.
- **Loop**: NO hot-reload. Restart `api` & wait `/health` after TS edits.
- **Force**: Aggregate `--force` banned. Use explicit nested tasks (`test:int:force`, `test:sys`, `ci:force`).
- **Gates**: `test:int:truth-checklist`, `golden:truth`, `test:int:ops-sql` are first-class nodes.
- **Health**: `svc:health` must fail if required Postgres extensions (currently `vector`) are unavailable; don't defer env drift to later migrations.
- **OCR Env Bridge**: compose `api`/`worker` must receive `ZAI_KEY` (+ endpoint override) from `fnox`/mise env; missing bridge is a hard boot failure.
- **Corepack Non-Interactive**: compose services using `corepack enable` must set `COREPACK_ENABLE_DOWNLOAD_PROMPT=0` to avoid boot hangs that break `svc:health`.
