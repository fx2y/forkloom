---
paths: ["src/**/*.tsx", "src/**/*.css", "web/**", "apps/**/src/**/*.tsx"]
---

# UI & State Rules

- **State:** Deterministic transitions only. Append-only event log is source-of-truth.
- **Async:** Explicit state machines. No boolean soup.
- **Idempotency:** Optimistic UI requires key + rollback path.
- **Copy:** Concise, imperative, operator-facing. No ambiguity.
- **Style:** Tokenized design variables. No ad-hoc inline drift.
- **A11y:** Keyboard nav, focus visibility, semantic controls.
- **Tests:** Reducers/selectors/replay determinism. Snapshots are secondary.
