---
paths: [".mise.toml", "mise-tasks/**", "scripts/lib/**/*.sh", "README.md"]
---
# Orchestration Law
- **DAG**: `.mise.toml` is the ONLY orchestrator. If it's not a DAG node, it doesn't exist.
- **Scripts**: `mise-tasks/` only. Must be non-executable.
- **Flow**: NO aggregate `--force`. Use explicit `test:sys`, `ci:force`.
- **Health**: `svc:health` MUST fail fast on missing dependencies (e.g., Postgres `vector`). Boot failures on missing env bridges (e.g., `ZAI_KEY`) are MANDATORY.