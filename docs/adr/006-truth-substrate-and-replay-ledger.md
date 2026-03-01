# ADR 006: Truth Substrate & Replay Ledger

## 1. Doctrine & Core Thesis

**Truth Triple Law**: `DB Ledger Rows + Session JSONL Tree + CAS Blobs`. If an output cannot deterministically join these keys, it is non-auditable tribal noise. There are zero heuristic edge inventions. 
**Strict-Real Mandate**: `PI_RPC_STRICT_REAL=1` is mandatory for live-value signoff. Mock claims yield zero shipped value. Non-strict paths are dev-only.
**Mise DAG is Executable Law**: If it's not codified in `.mise.toml` tasks (`check:scope-guard`, `golden:truth`, `fault:kill-resume`, `test:sys`, `ci:force`), it does not exist. Ad-hoc shell scripts cannot close release risk.

## 2. Substrate Schema (CY0-CY9)

Replay safety > developer convenience. 

### 2.1 The Additive C4 Ledger (`migration 005`)
- **`steps`**: DBOS step wrappers. Mandatory keys: `in_hash`, `out_hash`, `step_key`.
- **`links`**: Deterministic causal edges joining `runId ↔ step ↔ sessionEntry ↔ artifactSha`.
- **`sessions_index`**: Parsed PI JSONL trees. Captures `id`, `parent_id`, `leaf_id`, `root_id`. *Summaries are lossy views, never truth sources.* Tool call/result adjacency is enforced.
- **`step_payloads`**: Replay-safe, JSON-serializable step outputs. Missing payloads fail the CI merge checklist.

### 2.2 Hash & CAS Invariants
- **C14N Hashing**: Strict `stableStringify` + `hashJSON` for truth hashes. `canonicalizeValue` (with `VOLATILE_KEYS` scrub) is strictly isolated to fixture normalization. Raw `hashText(JSON.stringify(...))` is banned.
- **CAS Put**: Reserve-first CAS SQL -> Blob Store Write -> Rollback on fail. Overwrite blocked.

### 2.3 Txn Seam: `recordStepLedger`
**Atomicity Law**: Step/link/payload/session writes occur within a single repo-owned transaction seam: `runRepo.recordStepLedger`. Service-level SQL fan-out is dead (C115).

## 3. Public API & UX Contracts

### 3.1 Canonical `/truth` Endpoint
- **`GET /runs/:runId/truth`**: The single canonical audit payload (`TruthBundle`). 
- **NO Client Joins**: UI/CI consume the exact same payload. Reducer (`provenanceByArtifact`) derives strictly from TruthBundle links.
- **Scope Lock**: Public API noun surface is strictly `run`-owned. `Sandbox*` / observability / event-bus / external DB scopes are strictly deferred and banned from CY0-CY9 (R13).

### 3.2 Infinite SSE & Terminal Guards
- **SSE Continuity**: Run SSE NEVER auto-closes on terminal events. Reconnect cursors (`lastEventSeq`) own the lifecycle (C113).
- **Queue Deadlock Guard**: Terminal runs (`done` / `failed`) reject `queueCommand` with `409 Conflict` synchronously (C114).

### 3.3 Text-Node UI Rendering
- Provenance UI relies on DOM text nodes and attributes. `innerHTML` is fully banned and scanned out of existence to prevent HTML injection regressions (C104).

## 4. Replay & Orchestration Execution

### 4.1 Orchestrator Modes
- **R0 Stub Replay**: Matches identical artifact SHA sets using DB-persisted `step_payloads`.
- **R-Debug Skip-Step**: Branches on `REPLAY_RUN_ID` and executes orchestration paths WITHOUT `backend.exec` or `createPiSession` live side-effects (C102).

### 4.2 Failed Step Causality
Dead-lettering without failed-step evidence is merge-blocking (C111). `markFailed` path writes explicit `run_command_dead` and `run_command_requeue` ledger rows, capturing the failure hash and `note=error`.

### 4.3 Health Quorum Determinism
Mounted compose `api` does not hot-reload TS. Any live lane restart is guarded by a 120s health quorum (`wait_for_url_stable`) to eliminate probe-of-record races (C116).

---

## 5. Walkthroughs & Triage Paths

### Playbook: Ops-First Drift RCA
*Rerunning workflows to debug drift wastes time and destroys context.*
**Triage Flow:** Recent Runs -> Drift Rows -> Truth Tuple.

```bash
# 1. Generate Ops SQL Pack report against prod/local DB
MISE_EXPERIMENTAL=1 mise run test:int:ops-sql
pnpm exec tsx scripts/harness/run-ops-sql-pack.ts <runId> .cache/spec06/ops-sql-pack.run.json

# 2. Correlate drift rows to Truth Endpoint Tuples
curl -fsS http://127.0.0.1:8080/runs/<runId>/truth | jq '.steps[] | select(.stepName=="run_command_dead")'
```

### Playbook: Crash/Resume Durability Verification
Ensuring execution from N -> N+1 with exactly-once side-effects.

```bash
# 1. Fault drill: kill between named DBOS steps
MISE_EXPERIMENTAL=1 mise run --force fault:kill-resume

# 2. Assert durability (zero duplicate artifact writes/step completions)
MISE_EXPERIMENTAL=1 mise run --force test:int:run-sandbox-durability
jq -e '.status=="ok" and .expectedCount==.replayCount' .cache/golden/replay.truth.json
```

### Playbook: C5 Doc Ingest Closure (spec-0/07)
Doc ingest is now part of the executable gate stack (GLM-OCR parse + cite-first run-owned search/resolve).

```bash
MISE_EXPERIMENTAL=1 mise run test:int:doc-corpus      # nasty docs manifest gate
MISE_EXPERIMENTAL=1 mise run test:int:doc-surface     # /runs/:id/doc/search|resolve + web cite UI
MISE_EXPERIMENTAL=1 mise run --force fault:doc-kill-resume
MISE_EXPERIMENTAL=1 mise run test:int:doc-checklist   # SQL checklist + final-proof-index
MISE_EXPERIMENTAL=1 mise run --force golden:doc
```

Hard latch: kill resume + checklist + docs scan must all be present in `.cache/spec07/final-proof-index.txt`.

---
**Status**: CY9 Closed / N940 Green.
**Req Full-Cover Miss Count**: `0`
**Archived**: `.cache/spec06/final-proof-index.txt`
