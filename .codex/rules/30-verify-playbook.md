---
paths:
  - "tests/**"
  - "scripts/harness/**"
  - "fixtures/**"
  - "schema/**"
  - "docker-compose.yml"
---

# Verification gates + debug playbook

Gate contract (all required unless scoped task run):
- `check:*`: lint/type/unit/contract.
- `test:int:*`: dbos-durability, dbos-runtime, pi-rpc, pi-rpc-live, artifact, ocr-doc.
- `golden:*`: canonicalize + diff (accept only intentional output changes).
- `fault:*`: kill-resume + once-guard.
- `bench:*`: latency + cost artifact emission.

Failure -> fix:
- `.env* files are forbidden`: delete `.env*`; move vars to `fnox.toml`; rerun `mise run bootstrap:doctor`.
- `missing required secret/env:`: `mise run bootstrap:secrets`; verify fnox profile export.
- `postgres is not ready`/`healthcheck failed`: `mise run svc:up svc:health`; inspect `docker compose ps/logs`.
- `seaweed healthcheck failed`: check `localhost:8333` reachability; 403 response can still be healthy.
- `expected first DBOS run to crash`: ensure crash marker reset (`.cache/dbos/crash.once`), then rerun dbos runtime test.
- `exactly-once violated`: verify unique index/idempotency key domain; reject any duplicate side-effect path.
- golden `diff -u` fails: inspect canonicalizer change; accept golden only with explicit rationale.
- pi-rpc-live real provider fails: allow mock fallback default; set `PI_RPC_STRICT_REAL=1` only for true-live gate intent.

Promotion rule:
- Any “partial” gate must be closed by live proof artifact + automated test before marking done.
