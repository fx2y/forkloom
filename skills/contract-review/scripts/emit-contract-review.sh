#!/usr/bin/env bash
set -euo pipefail

subject="${*:-contract draft}"
mkdir -p out

cat > out/contract-review.checklist.json <<JSON
{
  "kind": "contract_review_checklist_v1",
  "status": "ok",
  "clauses": [
    {
      "id": "clause-1",
      "title": "Termination notice is unilateral",
      "severity": "high",
      "citation": "doc:aaaaaaaa.. parse:contract:1 p4 chunk:term-1"
    }
  ],
  "risks": [
    "uncapped liability",
    "missing cure period"
  ],
  "redlines": [
    "Add bilateral termination with 30-day cure window",
    "Cap liability at 12 months fees"
  ]
}
JSON

cat > out/contract-review.redline.md <<MD
# Contract Redlines

Target: ${subject}

1. Replace unilateral termination with bilateral + cure period.
2. Add explicit liability cap and carve-outs.
MD

cat > out/contract-review.risks.csv <<'CSV'
id,severity,risk,owner
risk-1,high,uncapped liability,legal
risk-2,medium,missing cure period,procurement
CSV

echo "contract-review artifacts emitted"
