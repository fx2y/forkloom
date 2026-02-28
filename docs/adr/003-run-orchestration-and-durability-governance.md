# ADR 003: Run Orchestration & Durability Governance (Forkloom v1)

**Status:** Accepted | **Date:** 2026-02-28 | **Author:** Gemini CLI

## Doctrine
*   **Run-Centricity:** Every effect (PI, CAS, UI) belongs to a `Run`.
*   **Append-Only Truth:** `events` table is the sole source of run state transitions.
*   **Durable Orchestration:** DBOS `runStep` + `workflowID == runId` guarantees.
*   **Contract Strictness:** v1 nouns (`RunSpec`, `RunState`, `RunEvent`) are immutable.

## Decisions

### D1: v1 Noun Topology (The 5-Noun Freeze)
Orchestration scope restricted to 5 core nouns to prevent drift.
*   **RunSpec:** Immutable input (msg, files, model, toolset).
*   **RunState:** Derived projection (status, cursors, refs).
*   **RunEvent:** Atomic delta (Init, Staged, PiEvent, Done).
*   **ArtifactRef:** CAS pointer with namespaced meta.
*   **Artifact:** Immutable bytes (SHA256).

### D2: Append-Only Event Sourcing (SQL Truth)
Transitions persist as atomic JSONB rows in `events`.
*   **Pattern:** `INSERT INTO events (run_id, kind, payload) RETURNING event_id`.
*   **Ordering:** Strict `event_id` monotonicity for SSE replay.
*   **Projection:** `RunState` materialized via `RunRepo.get(runId)` (reduce events).

### D3: Streaming & Cursor Replay (SSE)
Client sync via Server-Sent Events with strict cursor semantics.
*   **Endpoint:** `GET /runs/:id/events`.
*   **Header:** `Last-Event-ID` (or query param).
*   **Query:** `SELECT * FROM events WHERE run_id = $1 AND event_id > $2 ORDER BY event_id ASC`.
*   **Dedupe:** Client must ignore events with `event_id <= last_seen`.

### D4: Durable Workflow (DBOS RunOnce)
Workflow lifecycle managed by DBOS `DurableWorkflow` runtime.
*   **Mapping:** `workflowID` in DBOS MUST equal `runId` in SQL.
*   **Atomic Steps:** Each stage (StageInputs, StartPi, Finalize) wrapped in `runStep`.
*   **Resume:** If crash occurs, DBOS resumes from last `runStep` using idempotent `RunRepo` ops.

### D5: Harness-First Verification (Live Smoke)
Verification bypasses UI to test contract/durability seams directly.
*   **Harness:** `scripts/harness/run-sse-live.ts` (SSE stability) and `dbos-live-runonce.ts` (crash-resume).
*   **Gate:** `test:int:run-sse` + `test:int:runonce-live` must pass for promotion.

### D6: Spec-05 Sandbox Freeze (CY1)
Sandbox work stays behind `apps/api/src/sandbox`; the public owner remains `run`.
*   **Public Edge:** preview/files/commands stay under `/runs*`; `/sandbox*` is intentionally absent.
*   **Reuse Law:** actor lease/queue semantics are reusable, but actor nouns do not cross onto run contracts.
*   **Protocol Reuse:** sandbox callers must reuse `pi/rpc-client` rather than fork a second JSONL transport.

---

## Technical Walkthrough

### 1. Run Event SQL Schema
```sql
CREATE TABLE IF NOT EXISTS events (
    event_id  BIGSERIAL PRIMARY KEY,
    run_id    UUID NOT NULL REFERENCES runs(run_id),
    kind      TEXT NOT NULL, -- 'run_staged', 'pi_event', 'run_done'
    payload   JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_events_run_id_seq ON events(run_id, event_id);
```

### 2. DBOS Durable Workflow (Snippet)
```typescript
// apps/api/src/workflow/runonce.ts
export async function runOnce(ctxt: WorkflowContext, runId: string) {
  // 1. Stage Inputs (Idempotent)
  await ctxt.runStep(async () => {
    const spec = await repo.getSpec(runId);
    const files = await stageToS3(spec.files);
    await repo.append(runId, 'run_staged', { files });
  });

  // 2. Drive PI (Effectful)
  const piStream = await ctxt.runStep(async () => startPi(runId));
  
  // 3. Pump Events (Transient -> Persistent)
  for await (const msg of piStream) {
    await repo.append(runId, 'pi_event', msg);
  }
}
```

### 3. SSE Cursor Query (Snippet)
```typescript
// apps/api/src/run/repo/postgres.ts
async listEventsSince(runId: string, cursor: number, limit = 100) {
  return sql`
    SELECT event_id, kind, payload 
    FROM events 
    WHERE run_id = ${runId} AND event_id > ${cursor}
    ORDER BY event_id ASC 
    LIMIT ${limit}
  `;
}
```

## Implications
*   **No Deletes:** `events` table is append-only. Cancellations are just events.
*   **Projection Latency:** Complex UI state must be projected in SQL views or memory.
*   **DBOS Coupling:** API requires DBOS runtime for workflow execution. No fallback.
