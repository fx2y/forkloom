---
paths: ["tests/**", "scripts/harness/**", "fixtures/**", "schema/**", "docker-compose.yml"]
---
# Verify & Debug Playbook
- Gates: `check:*` (lint/unit/contract) -> `test:int:*` (artifact/dbos/pi) -> `golden:*` -> `fault:*` -> `bench:*`.
- Proof > Prose: Live artifacts (`.cache/test-int/*.json`) close gates.
- Stale Code: Restart `api` via `svc:down` + `svc:up` before tests if source changed.
- Failure Playbook:
  - Secrets: Delete `.env*`, `mise run bootstrap:secrets`.
  - Auth: `PI_RPC_STRICT_REAL=1` needs `~/.pi/agent/*`.
  - Nested Caches: Use `test:int:force`, not aggregate `--force`.
  - Queue: Blocked actors don't drain. Transient faults requeue automatically.
  - Image attach: Works on `prompt` only. `followUp` is text-only.