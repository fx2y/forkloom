---
name: contract-review
description: Review contracts with deterministic checklist and redline artifacts. Use for clause risk, obligations, and remediation proposals.
allowed-tools:
  - Read
  - Bash
---
# contract-review

## Setup
Reuse the doc substrate end-to-end: `ingestDoc` -> `searchDocs` -> `resolveSpan`. Do not build bespoke NLP islands.

## Inputs
- Contract context and ask: `$ARGUMENTS`
- Optional playbook: [review rubric](references/review-rubric.md)

## Procedure
1. Ensure source contract is ingested (`ingestDoc`) before analysis.
2. Retrieve high-risk clauses with cite-first `searchDocs` and `resolveSpan`.
3. Emit deterministic checklist + redline artifacts via [review emitter](scripts/emit-contract-review.sh).

## Outputs (ARTIFACTS)
- `out/contract-review.checklist.json` (schema: [checklist contract](assets/contract-review.checklist.schema.json))
- `out/contract-review.redline.md`
- `out/contract-review.risks.csv`

## Failure Modes + Recovery
- Missing citation evidence must produce `status=needs_input` instead of speculative redlines.
- No output artifact means task not done.
