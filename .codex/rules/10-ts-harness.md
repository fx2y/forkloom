---
paths:
  - "src/**/*.ts"
  - "scripts/**/*.ts"
  - "tests/**/*.ts"
---

# TS harness rules

- Core behavior in `src/**`: pure funcs, explicit types, deterministic output.
- `scripts/harness/**` are adapters only: parse args/env, call `src/**`, write artifacts, exit nonzero on invariant breach.
- Canonicalization rules are stable contract: strip volatile keys, sort keys, newline-normalize JSONL, hash canonical payload only.
- Time/random/process state in core logic is banned unless injected (clock/rng/deps as params).
- Errors must be operator-actionable (`what failed` + `what to run/check next`).
- Tests:
  - unit: each normalization/hash/idempotency primitive.
  - contract: schema acceptance/rejection.
  - integration: replay + live protocol/runtime gates.
- Refactors keep behavior snapshots stable (`fixtures/golden/**`); drift requires explicit golden update intent.
