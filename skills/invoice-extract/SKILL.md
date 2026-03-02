---
name: invoice-extract
description: Extract invoice line items to CSV and reconcile totals using existing ingest/OCR pipeline.
allowed-tools:
  - Read
  - Bash
---
# invoice-extract

## Setup
Pipeline is fixed: `ingestDoc` -> `executeDocOcr` -> postprocess -> CSV/reconcile artifacts. Never create a second OCR stack.

## Inputs
- Invoice context: `$ARGUMENTS`
- Optional mapping hints: [field map](references/field-map.md)

## Procedure
1. Ingest source invoice on run-owned doc route (`ingestDoc`).
2. Wait for OCR completion from existing workflow (`executeDocOcr`).
3. Emit CSV and reconcile outputs via [extractor script](scripts/emit-invoice-extract.sh).

## Outputs (ARTIFACTS)
- `out/invoice-lines.csv`
- `out/invoice-reconcile.json` (schema: [reconcile contract](assets/invoice-reconcile.schema.json))

## Failure Modes + Recovery
- If OCR evidence is absent, emit reconcile artifact with `status=needs_input`.
- Side storage is forbidden; output only through current artifacts.
