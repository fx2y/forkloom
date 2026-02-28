---
paths: ["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts", "apps/**/*.ts", "packages/**/*.ts"]
---

# TS Harness Rules

- **Strictness:** `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` mandatory.
- **Core:** Pure functions, explicit types, deterministic output. `src/**` is logic only.
- **Harness:** `scripts/harness/**` adapters parse args/env, call `src/**`, write artifacts.
- **Shared:** Primitives (hash, canon, wait) promoted to `@forkloom/shared`. No duplicate crypto/canon.
- **API Boundary:** Request parsing/validation moved from routes -> `http/request-parsers` w/ direct unit tests.
- **Canon:** Stable contract. Strip volatile, sort keys, newline-normalize JSONL, hash canon payload.
- **Purity:** Inject time/random/state (clock/rng/deps as params). Banned in core logic.
- **Health:** `wait_for_url` (common.sh) for reachability. Retry loop + hard-fail diagnostic.
- **Tests:**
  - unit: each normalization/hash/idempotency primitive + request-parsers.
  - contract: schema acceptance/rejection + examples.
  - integration: artifact, dbos-runtime (crash/resume), pi-rpc-live.
- **Refactors:** Stability via `fixtures/golden/**`. Drift requires explicit golden intent.
