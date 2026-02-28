# Run Orchestration & Durability Snippets

### SN301: Doctrine-Safe Entrypoints
```bash
# Bootstrap tools and secrets
MISE_EXPERIMENTAL=1 mise run bootstrap

# Boot full stack (Postgres + SeaweedFS + API + PI Mock)
MISE_EXPERIMENTAL=1 mise run svc
```

### SN302: Idempotent Run/Event DDL
```sql
CREATE TABLE IF NOT EXISTS runs (
    run_id UUID PRIMARY KEY,
    spec JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS events (
    event_id BIGSERIAL PRIMARY KEY,
    run_id UUID NOT NULL REFERENCES runs(run_id),
    kind TEXT NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS run_artifacts (
    run_id UUID NOT NULL REFERENCES runs(run_id),
    sha256 TEXT NOT NULL,
    meta JSONB NOT NULL,
    PRIMARY KEY (run_id, sha256)
);
```

### SN303: RunRepo Port Definition
```typescript
export interface RunRepo {
  createRun(id: string, spec: RunSpec): Promise<void>;
  appendEvent(id: string, kind: string, payload: any): Promise<number>;
  listEventsSince(id: string, cursor: number): Promise<RunEvent[]>;
  markDone(id: string, status: 'done' | 'failed'): Promise<void>;
  getProjection(id: string): Promise<RunState>;
}
```

### SN304: Atomic Event Emission
```typescript
async appendEvent(runId: string, kind: string, payload: any): Promise<number> {
  const [row] = await sql`
    INSERT INTO events (run_id, kind, payload)
    VALUES (${runId}, ${kind}, ${sql.json(payload)})
    RETURNING event_id
  `;
  return row.event_id;
}
```

### SN305: DBOS Workflow Registration
```typescript
// Register the RunOnce durable workflow
const RunOnce = DBOS.registerWorkflow(runOnce, { name: "forkloomRunOnce" });

// Start with workflowID identical to runId for durability mapping
await DBOS.startWorkflow(RunOnce, { workflowID: runId })(runId);
```
