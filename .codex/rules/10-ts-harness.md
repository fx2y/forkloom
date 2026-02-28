---
paths: ["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts", "apps/**/*.ts", "packages/**/*.ts"]
---
# TS/Harness Rules
- Types: `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` MANDATORY.
- Purity: `src/**` logic ONLY. Inject time/rng/deps. Explicit state machines. No boolean soup.
- Boundary: HTTP parses/validates; zero storage coupling. `http/request-parsers` unit-tested.
- Canon: Sort keys, newline-normalize JSONL, deterministic hash. Primitives in `@forkloom/shared`.
- Health: `wait_for_url` (common.sh) reachability > 2xx. Retry loop + hard-fail.
- Stability: Refactor guarded by `fixtures/golden/**`. Drift requires explicit intent.