---
paths:
  - "src/**/*.ts"
  - "scripts/**/*.ts"
  - "tests/**/*.ts"
  - "apps/**/*.ts"
  - "packages/**/*.ts"
---

# TS Harness Rules

- **Strictness:** `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` mandatory.
- **Core:** Pure functions, explicit types, deterministic output. `src/**` is logic only.
- **Harness:** `scripts/harness/**` adapters parse args/env, call `src/**`, write artifacts, exit nonzero.
- **Shared:** Promote primitives (hash, canon, wait) to `@forkloom/shared`. No duplicate crypto/canon.
- **API Boundary:** Request parsing/validation moved from routes -> `http/request-parsers`. Direct unit tests required.
- **Canon:** Stable contract. Strip volatile, sort keys, newline-normalize JSONL, hash canon payload ONLY.
- **Purity:** Inject time/random/state (clock/rng/deps as params). Banned in core logic.
- **Errors:** Operator-actionable: `what failed` + `what to run/check next`.
- **Tests:**
  - unit: each normalization/hash/idempotency primitive + request-parsers.
  - contract: schema acceptance/rejection + examples.
  - integration: replay + live protocol/runtime gates (dbos-runtime, pi-rpc-live).
- **Refactors:** Stability via `fixtures/golden/**`. Drift requires explicit golden intent.
