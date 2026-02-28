---
paths: ["apps/api/**", "contracts/**", "packages/contracts/**"]
---

# API & Contract Rules

- **Artifacts (CAS):**
  - **Immutable:** Exact-byte hash. Overwrite forbidden (409).
  - **Reserve-First:** SQL reserve (guard) -> write (store). Rollback on failure.
  - **Meta:** Namespaced lowercase. Validation delegated to contracts.
- **Contracts:**
  - **Source:** Schema source-of-truth. Schema edits fail without typegen update.
  - **Governance:** Drift check (schema vs typegen vs examples) + noun-ban (5-noun freeze).
  - **Boundary:** v1 isolation. Run nouns isolated in `contracts/v1`.
- **Durability (DBOS):**
  - **Proof:** Unique bytes per run before counting step outputs.
  - **Runtime:** `DbosStepRunner` injected by API bootstrap; no inline fallbacks.
- **Modularity:**
  - **SoC:** ports/adapters/service/http with idempotent SQL migrations.
  - **Parsers:** `http/request-parsers` with direct unit tests. Routes stay thin.
- **Promotion:** API change verified via `test:int:artifact` and `test:int:dbos-runtime`.
