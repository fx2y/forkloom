---
paths: ["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts", "apps/**/*.ts", "packages/**/*.ts"]
---
# TS & Logic Law
- **Types**: `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` MANDATORY.
- **Purity**: Core logic must be pure. Inject I/O, time, RNG. Avoid boolean soup.
- **Boundary**: HTTP routes parse/delegate ONLY. Zero business/storage logic in routes.
- **Canon**: Sort keys, newline-normalize JSONL, strict hash via `@forkloom/shared`.
- **Probes**: Blocking `wait_for_url` beats single-shot curl.