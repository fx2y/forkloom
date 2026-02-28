---
paths: [".mise.toml", "mise-tasks/**", "scripts/lib/**/*.sh", "README.md"]
---

# Mise DAG/Task Rules

- **Orchestration:** Explicit DAG in `.mise.toml`. No auto-discovery.
- **Runtime:** `MISE_EXPERIMENTAL=1` for `run/prep/watch`.
- **Scripts:** `run = "bash ./mise-tasks/<group>/<name>"` in stanza. Non-exec task files.
- **Cache:** `write_mark "<task:name>"` -> `.cache/mise-marks/<task__name>.ok`.
- **Reset:** `svc:reset` must purge stale probes and handle root-owned `.data/seaweed`.
- **PI Mode:** `pi` compose service runs real `pi --mode rpc` as stdio.
- **CI:** `ci:force` MUST remain a sequential list of phases. No single multi-arg runs.
- **Docs:** README command blocks = real entrypoints. Docs drift = build breakage.
