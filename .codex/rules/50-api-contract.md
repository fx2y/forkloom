---
paths:
  - "apps/api/**"
  - "contracts/**"
  - "packages/contracts/**"
---

# API & Contract Rules

- **Artifacts (CAS):**
  - **Immutable:** Exact-byte hash, immutable bytes. Overwrite forbidden (409).
  - **Reserve-First:** SQL reserve (guard) -> write (store). Rollback on store failure.
  - **Meta:** Namespaced lowercase pattern. Enforced upload+link boundaries.
  - **Validation:** Meta validation delegated to contracts validator at HTTP boundary.
- **Contracts (v0):**
  - **Source:** Schema source-of-truth. Schema edits fail without typegen update.
  - **Governance:** Drift check (schema vs typegen vs examples) + noun-ban (5-noun freeze).
  - **Boundary:** Upload+link enforce same key regex as contracts/v0 without duplication.
- **Durability (DBOS):**
  - **Proof:** Unique bytes per run before counting step outputs.
  - **Runtime:** `DbosStepRunner` must execute steps through workflow wrapper.
  - **Injected:** Runner injected by API bootstrap; no inline fallbacks outside DBOS trace.
- **Modularity:**
  - **SoC:** ports/adapters/service/http with idempotent SQL migrations.
  - **Parsers:** request parsing/validation moved from routes -> `http/request-parsers`.
- **Promotion:** Any API change must be verified via `test:int:artifact` and `test:int:dbos-runtime`.
