---
paths:
  - ".mise.toml"
  - "mise-tasks/**"
  - "scripts/lib/**/*.sh"
  - "README.md"
---

# Mise DAG/task rules

- DAG is explicit in `.mise.toml` (`depends`,`sources`,`outputs`); never rely on implicit file-task discovery.
- Task runner stanza form: `run = "bash ./mise-tasks/<group>/<name>"`; keep task files non-exec to avoid shadow behavior.
- Every cacheable task writes one marker via `write_mark "<task:name>"`; marker path is `.cache/mise-marks/<task__name>.ok`.
- Service-coupled tasks must prove readiness (retry loop + hard fail message), not optimistic start-only.
- Seaweed S3 health is reachability (`curl -sS`), not strict 2xx (auth root can be 403 by design).
- `ci:force` must remain sequential list of forced phase runs: `check,test:int,golden,fault,bench`.
- README command blocks mirror real entrypoints; docs drift is treated as build breakage.
