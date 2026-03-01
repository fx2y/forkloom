---
paths: ["tests/**", "scripts/harness/**", "fixtures/**", "schema/**", "docker-compose.yml"]
---
# Verify & Debug Playbook
- Gates: `check:*` -> `test:int:*` -> `golden:*` -> `fault:*` -> `test:sys` -> `bench:*`.
- Fault: Post-fault smoke MUST block on `/health` 200.
- DBOS: Replay safety > convenience. Step outputs MUST be JSON serializable. Process-local handles (`PiSessionPort`) BANNED across step boundaries.
- Live Web: Opt-in `FORKLOOM_LIVE_WEB_E2E=1` ONLY.
- C4 Evidence: `test:int:truth-checklist` MUST hard-fail on missing step hashes/links/artifacts/session leaf links; `golden:truth` MUST assert replay sha-set equality.
- Ops Close: `test:int:ops-sql` publishes executable recent-run + drift queries; no narrative-only debugging playbook.
- Failure Playbook:
  - Secrets: Delete `.env*`, `mise run bootstrap:secrets`.
  - Queue: `persistExec` strict claim/lease mismatch hard-fails. Stale workers blocked.
