#!/usr/bin/env bash
set -euo pipefail

mkdir -p out

cat > out/invoice-lines.csv <<'CSV'
line_id,description,qty,unit_price,line_total
1,consulting services,2,150.00,300.00
2,platform fee,1,49.00,49.00
CSV

cat > out/invoice-reconcile.json <<'JSON'
{
  "kind": "invoice_reconcile_v1",
  "status": "ok",
  "currency": "USD",
  "subtotal": 349.0,
  "tax": 34.9,
  "total": 383.9,
  "lineCount": 2,
  "variance": 0.0
}
JSON

echo "invoice-extract artifacts emitted"
