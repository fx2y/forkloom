---
paths: [".mise.toml", "mise-tasks/**", "scripts/lib/**/*.sh", "README.md"]
---
# Orchestration Law
- **DAG**: `.mise.toml` is ONLY orchestrator. Unlisted lane = non-existent.
- **Scripts**: `mise-tasks/` MUST be non-executable.
- **Pipeline**: Sequential `ci:force`. NO aggregate `--force`. Local mock for compose pi; real proof in `test:int`.
- **Boot**: Secret checks in `bootstrap:secrets`. Bounded polling for `/health` post-restart. Fast-fail on missing deps.