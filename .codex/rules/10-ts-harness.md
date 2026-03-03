---
paths: ["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts", "apps/**/*.ts", "packages/**/*.ts"]
---
# TS & Logic Law
- **Strictness**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` MANDATORY.
- **Purity**: Isolate core logic from HTTP/shell. Inject I/O, RNG, time. Package logic in pure `pi/packages` modules.
- **Canon**: Centralized `@forkloom/shared` for hash/sort/JSONL. Normalize BEFORE hashing.
- **Resolvers**: Identity+pin law frozen (npm name, git url sans ref, local realpath). Project-wins settings merge.
- **Filters**: Declarative narrowing ONLY (`undefined`=all, `[]`=none, `!`=exclude, `+`=include, `-`=exact exclude). NO feature-flag runtime if-branches.
- **Probes**: Use bounded retry (`waitFor`, `wait_for_url`). NO single-shot. Bounded startup reconcile (attempts/installed/remainingMissing).