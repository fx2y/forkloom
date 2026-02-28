# ADR 004: Actor, Mailbox, and Thread Orchestration

## 1. Context & North Star
**Value Proposition:** Provide durable, strictly serialized actor/mailbox execution backed by live PI inference (`PI_RPC_STRICT_REAL=1`), DBOS queues, and deterministic event-log UX. 
**Doctrine:** 
- Strict-real demo or stop. Mock is for CI only (DOC-01). 
- API/DB nouns: `actor`, `mailbox`. UI copy: `thread` (DOC-02, T120). 
- State truth: Append-only `ActorEvent` reducer > `ActorState.status` (DOC-03, T610).
- Proof > Prose: Claims require `.cache/test-int/*.json` artifacts (DOC-08).

## 2. Core Architecture

### 2.1 Persistence & Model (CY2)
- **Nouns (v1 freeze):** `ActorSpec`, `MailboxPost`, `ActorState`, `ActorEvent`.
- **SQL Source of Truth:** Seq allocations, FSM locks, dedupe run inside Postgres. No JS memory queues (T210).
- **Schema Extract:**
  ```sql
  CREATE TABLE actor (... mailbox_cursor, status ...);
  CREATE TABLE mailbox_msg (... UNIQUE(actor_id, seq), UNIQUE(actor_id, dedupe_key));
  CREATE INDEX ix_mailbox_claim ON mailbox_msg(actor_id, state, seq);
  CREATE TABLE actor_event (actor_id, event JSONB); -- S08
  ```

### 2.2 Tick Runtime & DBOS (CY3)
- **Execution:** One active tick per actor via row-lock (`actor_lock`) + DBOS workflowID dedupe (`tick:<actorId>:<seq>`) (T330).
- **Frozen Steps (T320):** `acquireLock` -> `claimBatch` -> `loadActor` -> `ensureSession` -> `applyBatch` -> `persistBatch` -> `markBatch` -> `releaseLock`.
- **Fault Law (TR-08):** `ActorTransientError` requeues. Blocked/dead actors stay inert; no background magic drain (C52).

### 2.3 PI Integration & Session Mapping (CY4)
- **Process Mgmt:** `PiActorBatchProcessor` is batch-scoped. Close child on `applyBatch` finish. No unbounded immortal cache (C51).
- **Handoff & Resume (C50):** Reopened `pi_session_file` dictates session. Ephemeral PI session IDs are overridden by durable `pi_session_id` to prevent drift.
- **Mailbox -> PI Mapping (S07):**
  - **Prompt:** Idle. Carries text + binary attachment bytes (C53).
  - **FollowUp:** Streaming. Text/refs only.
  - **Steer:** Explicit interrupt. Priority singleton.

### 2.4 Transport & SSE (CY5)
- **Open-Ended Streams (T530):** Actor SSE never auto-closes on mailbox completion (unlike run-terminal). Client manages disconnect.
- **Buffer/Replay:** Gap frame recovery `reconnectFrom=lastDeliveredSeq`. Query: `seq > cursor` limit 1..1000 (C20, C54).
- **Minimal Surface:** Public `ActorState` omits lock/session keys to prevent HTTP-layer coupling (T510).

### 2.5 Web & Inbox Reducer (CY6)
- **Strict UI Reducer:** `ActorState.status` is weak. UI state derives natively from `ActorEvent` payload trace + summaries.
- **XSS-Safe Boundaries:** Render via DOM text nodes. `innerHTML` banned (C55).
- **Client Policy (S10):**
  ```ts
  const kind = actor.status === 'streaming' 
    ? (interrupt ? 'steer' : 'followUp') 
    : 'prompt';
  ```

## 3. Playbook & Verifications (CY7)

### Operator Paths
- `mise` + `fnox` only. No `.env`. Imperative un-cached reset via `mise run svc:reset` (clears marks).
- Any source edits: Requires `svc:down` + `svc:up` to purge mounted `tsx` before live tasks (C63).

### Live Gate Matrix (Proof Artifacts)
1. **Functional (`test:int:actor-functional`):** 
   - Proves attachment end-to-end traversal + session row persistence + strict-real provenance (`fallbackUsed=false`).
2. **Steer/Restart (`test:int:actor-steer-live`):** 
   - Proves durable session id preservation across API reboot. Steer interrupts via `/actors`.
3. **Replay (`test:int:actor-sse`):** 
   - Two-tab trace. Proves strict `seq > cursor` gap recovery without dupes.
4. **Durability (`test:int:actor-durability`):** 
   - Kills mid-`applyBatch`. Asserts recovered DBOS DB rows (`persistedActorEventCount`, `lockCount=0`).
5. **System (`ci:force`):** 
   - Sequential lock: `check` -> `test:int:force` -> `golden` -> `fault` -> `test:sys` -> `bench`. Nested parallel force is invalid (C49).

### Common Troubleshooting
- **`/health` pi:false:** Missing host `~/.pi/agent/*` or auth race. Strict real allocates isolated writable mirrored HOME (C60, TR-02).
- **Post 404:** No auto-create on messages. Must POST `/actors` first (TR-05).
- **Queue stalled:** Check status. Only transient faults requeue.
