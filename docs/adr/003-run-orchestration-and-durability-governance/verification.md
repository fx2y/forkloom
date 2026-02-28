# Run Verification Matrix (C1/Spec-03)

This matrix defines the authoritative gates for v1 promotion.

| ID | Gate | Command | Success Criteria | Failure Modes |
|---|---|---|---|---|
| **K01** | Policy | `mise run bootstrap:doctor` | `bootstrap:doctor ok` | `.env` presence, missing tools, PI auth drift. |
| **K02** | PI Auth | `PI_RPC_STRICT_REAL=1 mise run bootstrap:doctor` | `~/.pi/agent/auth.json` exists | Strict-real PI requires host state file. |
| **K03** | Health | `mise run svc:health` | `ok: true` in `/health` | Postgres, SeaweedFS, or PI Mock down. |
| **K04** | CAS | `curl ... /artifacts` | Same bytes => Same SHA | SHA drift, missing meta, byte mismatch. |
| **K05** | Idempotency| `POST /runs` x2 | First: 201; Second: 200/409 | Duplicate workflow launch; orphan row. |
| **K06** | SSE Replay | `mise run test:int:run-sse` | Replay seqs match live seqs | Sequence gaps, stale seq, non-closing terminal. |
| **K07** | Durability | `mise run test:int:run-durability` | All critical effect counts = 1 | Effect count 0 or >1 (at-least-once violation). |
| **K08** | Proof Chain | `mise run ci:force` | All phases (check->bench) rerun | Phase skip, stale cache, missing marks. |
| **K09** | Boundary | `D49` Learning check | Pre-startPi boundary respected | Claiming mid-session restart without proof. |
| **K10** | UI Truth | `rg "abort|steer" app.ts` | No dead controls | UI elements exist without API backing. |
