---
paths: ["tests/**", "scripts/harness/**", "fixtures/**", "schema/**", "docker-compose.yml"]
---

# Verification Gates + Debug Playbook

- `check:*`: lint/type/unit/contract/lesson-guard.
- `test:int:*`: artifact, dbos-durability, dbos-runtime, pi-rpc-live.
- `golden:*`: canonicalize + diff (accept intentional output changes).
- `fault:*`: kill-resume + once-guard.
- `bench:*`: latency + cost artifact emission.

## Failure Playbook
- **.env forbidden:** Delete `.env*` from root/deep; rerun `bootstrap:doctor`.
- **missing secret:** `mise run bootstrap:secrets`; check fnox profile.
- **pg/seaweed not ready:** `mise run svc:up svc:health`; inspect `docker compose logs`.
- **dbos crash:** Ensure `.cache/dbos/crash.once` reset; rerun `test:int:dbos-runtime`.
- **lesson-guard:** Local diff (work-tree+staged+untracked) or CI diff (range/merge-base).
- **ci:force:** phase skip in logs; ensure sequential forced phases.

## Promotion Rule
- Gate closed by live proof artifact + automated test before marking done.
- `test:sys` MUST force prerequisite gates and fail on cached skip markers.
