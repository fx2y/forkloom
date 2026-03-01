# ADR 005: Sandbox Orchestration & Run Surface Ownership

**Date**: 2026-03-01
**Status**: Adopted

## Context

Delivery of Spec-05 (C3 runner) requires driving Docker compute via an LLM (PI), durable human-in-the-loop pauses (approval), workspace snapshotting (CAS), and zero-loss UI. Previous learnings (`00-learnings.sqlite`, `05-htn.sqlite`) emphasize strict isolation of compute primitives, `mise`-only orchestration, immutable CAS artifacts, and bulletproof crash-resume guarantees (DBOS).

This ADR formalizes the doctrine for building the `RunSandbox` orchestrator and its UI/API boundaries.

---

## 1. Strict Boundary: `run` vs. `sandbox`

**Law**: `run` owns the public interface; `sandbox` owns the compute substrate.
*   **Contract**: Routes, SSE, and events are scoped strictly to `/runs` and `RunSpec`/`RunState`/`RunEvent` (`contracts/v1`). Top-level `/sandbox` routes or `Sandbox*` public nouns are **BANNED**.
*   **Compute Isolation**: Docker CLI logic (`docker-backend.ts`), volume lifecycle, and child-process execution live exclusively in `apps/api/src/sandbox`.
*   **Identity**: Container identity is ephemeral/disposable. Workspace/Volume identity is durable.

## 2. DBOS Durability & State Governance

**Law**: DBOS workflow steps MUST emit JSON-serializable outputs.
*   **No Cross-Step Handles**: Returning or persisting `PiSessionPort`, DB connections, or live sockets across DBOS steps causes silent replay failure and violates crash-resume.
*   **Workflow Addressing**: Sandbox workflow dispatch uses the prefix `run:` (e.g., `workflowID: run:${runId}`). This allows safe concurrent routing vs legacy `RunOnce`.
*   **Idempotent Execution**: Commands and state transitions occur inside isolated `@Step` functions. If a process dies, DBOS skips completed steps based on durable JSON output hashes.

## 3. UI Truth & Event Sourcing

**Law**: Zero `innerHTML`. Truth is derived strictly from durable projections.
*   **Render Policy**: UI mounts via static fragments (`replaceChildren`) and text nodes/attributes only.
*   **Truth Derivation**: State (WILL-RUN, approvals, files) derives completely from append-only `ActorEvent` streams and projected `RunState`. No runtime guesses.
*   **Export Gate**: Export functionality is valid and active **ONLY** after a durable `workspaceRef` snapshot exists. Pre-approve priv commands reject HTTP 409.

## 4. SSE Transport Integrity

**Law**: Infinite streams. The client manages its own reconnects.
*   **No Auto-Close**: Server does not auto-close on `run_done` or `mailbox_processed`.
*   **Cursor Replay**: Client utilizes `Last-Event-ID` to resume. Server sends gap frames on buffer drops, instructing explicit reconnects. No silent loss.

## 5. Artifacts & Inputs

**Law**: Reserve-first SQL → store write → rollback. Exact-byte matching.
*   **Input Staging**: Prompt images and context resolve strictly against staged `/inputs`. Implicit host-side bypasses are forbidden.
*   **Path Alignment**: To ensure raw Docker exec compatibility, host mount paths must match container absolute paths perfectly (e.g., `/home/user/projects/...` mapped identically inside the API container).

---

## Technical Walkthroughs & Patterns

### 1. DBOS Step Serialization

**ANTI-PATTERN (Brittle)**
```typescript
@Step() async initPi() { return new PiSessionPort(); } // 🚨 Error: Not JSON serializable!

@Workflow() async run() { 
  const pi = await this.initPi(); // Fails to resume if process dies here.
  await this.promptPi(pi);
}
```

**PATTERN (Durable)**
```typescript
@Step() async initPi(id: string) { 
  await this.sandbox.ensureSession(id); 
  return id; // JSON serializable primitive
}

@Workflow() async run() {
  const sessionId = await this.initPi(runId);
  // Re-acquire session internally within the step execution boundary
  await this.promptPi(sessionId); 
}
```

### 2. Event Sourced Transport (SSE)
```mermaid
sequenceDiagram
    participant UI
    participant /runs/:id/events
    participant DBOS Workflow
    
    UI->>/runs/:id/events: Connect (Last-Event-ID: null)
    DBOS Workflow->>DB: Insert ActorEvent (seq: 1)
    DB-->>/runs/:id/events: notify
    /runs/:id/events->>UI: id: 1
data: { ... }
    
    Note over UI,DB: Network Interrupt
    
    UI->>/runs/:id/events: Reconnect (Last-Event-ID: 1)
    /runs/:id/events->>DB: SELECT WHERE seq > 1
    DB-->>/runs/:id/events: Rows [seq: 2]
    /runs/:id/events->>UI: id: 2
data: { ... }
```

### 3. Pipeline: Approval Law

1.  Client POSTs `run` with `profile: priv`.
2.  DBOS workflow initializes staging and sets `approval_state = pending`.
3.  Workflow execution pauses (via `dbos.recvEvent("cmd_queue")`).
4.  Client UX strictly gates interaction; displays WILL-RUN preview.
5.  Client POSTs `{ type: "approve" }` to `/runs/:id/commands`.
6.  API validates `approval_state` and signals the workflow via `dbos.sendEvent`.
7.  DBOS resumes, delegates to `sandbox.exec`, and persists `sandbox_exec` audit arrays.

## Implications

*   **Refactoring constraints**: `src/run` developers do not need Docker knowledge; `src/sandbox` developers do not need HTTP/Transport knowledge.
*   **Operational hygiene**: Using `mise svc:reset` natively sweeps `sbx-*` orphan containers because they are isolated primitives with distinct metadata tags, preventing volume-lock bugs.

## CY8/CY9 Addendum: C4 Gate Closure

*   **Executable evidence gate**: CI now requires SQL checklist integrity (`steps/links/artifact/session leaf`) plus golden replay-truth proof in canonical `mise` DAG lanes (`test:int:truth-checklist`, `golden:truth`, `ci:force`).
*   **Operator SQL pack**: Debug workflow is codified as copy-paste SQL + `queryRows` harness helper; operators can inspect recent runs and step hash drift without rerunning workloads.
*   **Scope guard lock**: C4 explicitly defers generalized observability, extra event bus, and provenance DB/time-travel DB. Run-owned public surface remains `/runs*`; `Sandbox*` public nouns stay banned.
