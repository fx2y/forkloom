---
paths: [".mise.toml", "mise-tasks/**", "scripts/lib/**/*.sh", "README.md"]
---
# Mise/DAG Rules
- DAG: Explicit `.mise.toml`. No auto-discovery. Cache via `write_mark`.
- Scripts: Non-exec task files. `bash ./mise-tasks/<group>/<name>`.
- Reset: `svc:reset` imperative ops (uncached), purges stale probes & root-owned docker binds.
- Live Loop: `svc:up` runs plain `tsx`. MUST restart `api` container after edits. No hot-reload.
- CI/Sys: `test:sys`/`ci:force` force explicit nested serial phases. Aggregate `--force` insufficient.