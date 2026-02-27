---
paths:
  - ".mise.toml"
  - "mise-tasks/**"
  - "scripts/lib/**/*.sh"
  - "README.md"
---

# Mise DAG/Task Rules

- **Orchestration:** Explicit DAG in `.mise.toml` (`depends`,`sources`,`outputs`). No file-task auto-discovery.
- **Runtime:** `MISE_EXPERIMENTAL=1` required for all `mise run/prep/watch`.
- **Scripts:** `run = "bash ./mise-tasks/<group>/<name>"` in stanza. Non-exec task files.
- **Cache:** `write_mark "<task:name>"` -> `.cache/mise-marks/<task__name>.ok`.
- **Reset:** `svc:reset` must:
  - remove stale `/tmp` and `.tmp` probes.
  - fail on purge errors (no mask).
  - use docker-root fallback for root-owned `.data/seaweed`.
- **Health:** Ready = retry loop + hard-fail diagnostic. `common.sh:wait_for_url` used for reachability.
- **PI Runtime Mode:** `pi` compose service runs real `pi --mode rpc` as stdio (no HTTP server). Health for `pi` is container-running check, not `/health` probe.
- **CI:** `ci:force` MUST remain a sequential list of forced phases: `check,test:int,golden,fault,bench`. No single multi-arg runs.
- **Docs:** README command blocks = real entrypoints. Docs drift is build breakage.
