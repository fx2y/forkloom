---
paths:
  - "tests/**"
  - "scripts/harness/**"
  - "fixtures/**"
  - "schema/**"
  - "docker-compose.yml"
---

# Verification Gates + Debug Playbook

- `check:*`: lint/type/unit/contract/lesson-guard.
- `test:int:*`: artifact, dbos-durability, dbos-runtime, pi-rpc-live, ocr-doc.
- `golden:*`: canonicalize + diff (accept intentional output changes).
- `fault:*`: kill-resume + once-guard.
- `bench:*`: latency + cost artifact emission.

## Failure Playbook (P0/P1)
- **.env forbidden:** delete `.env*` from root/deep; rerun `bootstrap:doctor`.
- **missing secret:** `mise run bootstrap:secrets`; check fnox profile.
- **pg not ready:** `mise run svc:up svc:health`; inspect `docker compose logs`.
- **seaweed health:** check `localhost:8333` reachability; 403 can be healthy.
- **dbos crash:** ensure `.cache/dbos/crash.once` reset; rerun `test:int:dbos-runtime`.
- **exactly-once:** check unique guard/SQL idempotency domain.
- **pi-rpc-live:** check credentials; allow mock fallback unless `PI_RPC_STRICT_REAL=1`.
- **lesson-guard:** code delta lacks `AGENTS.md` or `tests/` delta.
- **artifact hash:** byte mutation in path; rerun `test:int:artifact`.
- **invalid meta:** key rejected by `validateArtifactMeta|parseMeta`.
- **reset errors:** stale probes in `/tmp` or root-owned `.data/seaweed`.
- **ci:force:** phase skip in logs; ensure sequential forced phases in `.mise.toml`.
- **contract drift:** schema vs typegen vs examples out of sync.

## Promotion Rule
- Any “partial” gate must be closed by live proof artifact + automated test before marking done.
- System proof (`test:sys`) MUST force prerequisite gates and fail on any cached skip marker.
