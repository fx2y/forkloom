# ADR 004 Supplemental Assets

## Tick Runtime Diagram

```mermaid
sequenceDiagram
    participant Web as Web (Thread UI)
    participant Route as API Route (/actors)
    participant DB as Postgres (actor/mailbox)
    participant Q as DBOS Queue
    participant Tick as ActorTick Workflow
    participant PI as PiSessionPort

    Web->>Route: POST /actors/A/messages (prompt + sha)
    Route->>DB: INSERT mailbox_msg (kind: prompt)
    DB-->>Route: 201 Created
    Route->>Q: EnqueueMsg (tick:A:1)
    
    Q->>Tick: executeActorTick()
    Tick->>DB: acquireLock() & claimBatch()
    Tick->>DB: ensureSession()
    Tick->>PI: applyBatch() -> pi.prompt()
    PI-->>Tick: Stream / Done
    Tick->>DB: persistBatch() -> INSERT actor_event
    Tick->>DB: markBatch() -> done
    Tick->>DB: releaseLock()
```

## Data Model Invariants

- **`actor`**: Stores `mailbox_cursor` and `status`. Only mutated during event projections inside the DBOS step.
- **`mailbox_msg`**: Guards `UNIQUE(actor_id, seq)` and `UNIQUE(actor_id, dedupe_key)`. State transitions: `pending -> claimed -> done/failed`.
- **`actor_lock`**: Ensures only one active DBOS workflow per actor. Uses `expired_at` for lease semantics.
- **`actor_event`**: Append-only log. The ultimate truth for UI reducers (`seq`, `kind`, `payload`).
