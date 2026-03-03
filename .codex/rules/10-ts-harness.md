---
paths: ["src/**/*.ts", "scripts/**/*.ts", "tests/**/*.ts", "apps/**/*.ts", "packages/**/*.ts"]
---
# TS & Logic Law
- **Strictness**: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` MANDATORY.
- **Purity**: Isolate core logic from HTTP/shell. Inject I/O, RNG, time.
- **Canon**: Centralized `@forkloom/shared` for hash/sort/JSONL. Normalize BEFORE hashing.
- **Parsers**: Explicit bounded splitters. NO direct yaml deps. Shell-aware quote/escape arg tokenizer.
- **Probes**: Use bounded retry (`waitFor`, `wait_for_url`). NO single-shot curl.