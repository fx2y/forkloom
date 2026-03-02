---
name: policy-qa
description: Answer policy/procedure questions with cite-first evidence. Use when user asks policy, controls, handbook, or compliance questions.
allowed-tools:
  - Read
  - Bash
---
# policy-qa

## Setup
Use existing cite-first substrate only (`searchDocs` then `resolveSpan`). Never invent a second retrieval path.

## Inputs
- User question: `$ARGUMENTS`
- Optional policy context from [policy glossary](references/policy-glossary.md)

## Procedure
1. Run cite retrieval first (`searchDocs`) and gather top spans.
2. Resolve each cited span (`resolveSpan`) before drafting claims.
3. Emit typed artifacts through [emit script](scripts/emit-policy-answer.sh).

## Outputs (ARTIFACTS)
- `out/policy-qa.answer.json` (schema: [policy answer contract](assets/policy-qa.answer.schema.json))
- `out/policy-qa.citations.json`

## Failure Modes + Recovery
- If no citations are available, emit an empty-citation artifact with explicit `needs_follow_up=true`.
- Chat-only answers are invalid completion.
