---
paths:
  - "src/**/*.tsx"
  - "src/**/*.css"
  - "src/ui/**"
  - "web/**"
  - "apps/**/src/**/*.tsx"
---

# UI/content/state policy (future-facing, conditional)

- UI must expose deterministic state transitions; async chat flows use explicit event/state machine, not boolean soup.
- Source-of-truth is append-only event log shape compatible with `schema/pi-session-event.schema.json`; derived view state is pure.
- Optimistic UI allowed only with idempotency key + rollback path.
- Copy rules: concise, imperative, operator-facing; no ambiguous status text.
- Style rules: intentional visual direction, tokenized design vars, no ad-hoc inline style drift.
- Accessibility baseline: semantic controls, keyboard nav, focus visibility, color contrast.
- Tests required for reducers/selectors/replay determinism; snapshots alone are insufficient.
