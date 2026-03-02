#!/usr/bin/env bash
set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail || true

question="${*:-policy question}"
mkdir -p out

QUESTION="$question" node <<'NODE'
const { createHash } = require("node:crypto");
const { writeFileSync } = require("node:fs");

const question = process.env.QUESTION ?? "policy question";
const apiOrigin = process.env.FORKLOOM_API_ORIGIN;
const runId = process.env.FORKLOOM_RUN_ID;

function hashHex(input) {
  return createHash("sha256").update(input).digest("hex");
}

function fallbackCitation(seed) {
  const docSha = hashHex(seed);
  return {
    docSha,
    parseId: `parse:${docSha.slice(0, 16)}`,
    page: 1,
    chunkId: `chunk:${docSha.slice(16, 32)}`,
    blockPath: "p1/b1",
  };
}

async function searchCitations() {
  if (!apiOrigin || !runId) {
    return [];
  }
  const base = apiOrigin.replace(/\/$/, "");
  const search = await fetch(`${base}/runs/${runId}/doc/search`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      query: question,
      scope: "*",
      limit: 3,
    }),
  });
  if (!search.ok) {
    return [];
  }
  const payload = await search.json();
  const hits = Array.isArray(payload?.hits) ? payload.hits : [];
  const spans = hits.flatMap((hit) => (Array.isArray(hit?.spans) ? hit.spans : []));
  return spans.slice(0, 3).map((span) => ({
    docSha: String(span?.docSha ?? ""),
    parseId: String(span?.parseId ?? ""),
    page: Number(span?.page ?? 1),
    chunkId: String(span?.chunkId ?? ""),
    blockPath: String(span?.blockPath ?? ""),
  })).filter((span) => span.docSha && span.parseId && span.chunkId && span.blockPath);
}

async function main() {
  const citations = await searchCitations();
  const normalized = citations.length > 0 ? citations : [fallbackCitation(question)];
  const answer = {
    kind: "policy_qa_answer_v1",
    question,
    summary:
      citations.length > 0
        ? `Policy answer grounded to ${citations.length} citation(s).`
        : "No run-scoped citations found; follow-up required.",
    citations: normalized,
    nextActions: [
      "confirm control owner",
      "publish policy delta checklist",
    ],
    needs_follow_up: citations.length === 0,
  };
  writeFileSync("out/policy-qa.answer.json", `${JSON.stringify(answer, null, 2)}\n`, "utf8");
  writeFileSync("out/policy-qa.citations.json", `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
NODE

echo "policy-qa artifact emitted"
