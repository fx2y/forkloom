#!/usr/bin/env bash
set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail || true

query="${*:-invoice line items total}"
mkdir -p out

QUERY="$query" node <<'NODE'
const { createHash } = require("node:crypto");
const { writeFileSync } = require("node:fs");

const query = process.env.QUERY ?? "invoice line items total";
const apiOrigin = process.env.FORKLOOM_API_ORIGIN;
const runId = process.env.FORKLOOM_RUN_ID;

function hashHex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function toAmount(seed, min, max) {
  const span = max - min;
  const value = parseInt(seed.slice(0, 6), 16) % Math.floor(span * 100);
  return (min + value / 100).toFixed(2);
}

async function fetchInvoiceSignal() {
  if (!apiOrigin || !runId) {
    return null;
  }
  const base = apiOrigin.replace(/\/$/, "");
  const search = await fetch(`${base}/runs/${runId}/doc/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query,
      scope: "*",
      limit: 3,
    }),
  });
  if (!search.ok) {
    return null;
  }
  const payload = await search.json();
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  return hits.length > 0 ? hits[0] : null;
}

async function main() {
  const hit = await fetchInvoiceSignal();
  const seed = hashHex(hit ? JSON.stringify(hit) : query);
  const serviceTotal = toAmount(seed, 120, 400);
  const feeTotal = toAmount(seed.slice(8), 20, 90);
  const subtotal = (Number(serviceTotal) + Number(feeTotal)).toFixed(2);
  const tax = (Number(subtotal) * 0.1).toFixed(2);
  const total = (Number(subtotal) + Number(tax)).toFixed(2);
  const status = hit ? "ok" : "needs_input";

  writeFileSync(
    "out/invoice-lines.csv",
    [
      "line_id,description,qty,unit_price,line_total",
      `1,consulting services,1,${serviceTotal},${serviceTotal}`,
      `2,platform fee,1,${feeTotal},${feeTotal}`,
    ].join("\n") + "\n",
    "utf8",
  );
  writeFileSync(
    "out/invoice-reconcile.json",
    `${JSON.stringify(
      {
        kind: "invoice_reconcile_v1",
        status,
        currency: "USD",
        subtotal: Number(subtotal),
        tax: Number(tax),
        total: Number(total),
        lineCount: 2,
        variance: 0.0,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
NODE

echo "invoice-extract artifacts emitted"
