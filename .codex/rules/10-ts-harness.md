---
paths: ["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts", "apps/**/*.ts", "packages/**/*.ts"]
---
# TS/Harness
- **Types**: `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` MANDATORY.
- **Purity**: Core logic in `src/**`. Inject time/rng. Explicit FSMs. No boolean soup.
- **HTTP Boundary**: Routes parse/delegate ONLY. Zero storage coupling in routes.
- **Canon**: Sort keys, newline-normalize JSONL, strict hash via `@forkloom/shared`.
- **Probes**: Use `wait_for_url` for readiness. Blocking health probe beats single-shot curl.