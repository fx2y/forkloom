# C5 Doc Ingest Operator Runbook

This runbook is the executable C5 doc ingest path for spec-0/07 (GLM-OCR + deterministic cite-first retrieval).

## Flow

1. `MISE_EXPERIMENTAL=1 mise run svc:health`
2. `MISE_EXPERIMENTAL=1 mise run test:int:doc-corpus`
3. `MISE_EXPERIMENTAL=1 mise run test:int:doc-surface`
4. `MISE_EXPERIMENTAL=1 mise run --force fault:doc-kill-resume`
5. `MISE_EXPERIMENTAL=1 mise run test:int:doc-checklist`
6. `MISE_EXPERIMENTAL=1 mise run --force golden:doc`

## Intent

- `test:int:doc-corpus` keeps nasty docs versioned (`MANIFEST`, rotated/table/formula/stamp/lang coverage).
- `test:int:doc-surface` proves run-owned `/runs/:runId/doc/{search,resolve}` API + web cite rendering.
- `fault:doc-kill-resume` is the kill resume drill for doc-ocr/doc-index deterministic row+hash diff.
- `test:int:doc-checklist` enforces SQL checklist rows and writes `.cache/spec07/final-proof-index.txt`.

## Merge Latch

- `spec-0/07-htn.sqlite` req full-cover miss query must return `0`.
- `.cache/spec07/final-proof-index.txt` must include cy9 gate, corpus, crash, checklist, and docs scan paths.
