#!/usr/bin/env bash
set -euo pipefail

question="${*:-policy question}"
mkdir -p out
question_json="$(printf '%s' "$question" | sed -e 's/\\/\\\\/g' -e 's/\"/\\"/g')"

cat > out/policy-qa.answer.json <<JSON
{
  "kind": "policy_qa_answer_v1",
  "question": "${question_json}",
  "summary": "Policy answer drafted from cite-first evidence.",
  "citations": [
    {
      "docSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "parseId": "parse:policy:1",
      "page": 1,
      "chunkId": "chunk:policy:1",
      "blockPath": "p1/b1"
    }
  ],
  "nextActions": [
    "confirm control owner",
    "publish policy delta checklist"
  ],
  "needs_follow_up": false
}
JSON

cat > out/policy-qa.citations.json <<'JSON'
[
  {
    "docSha": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "parseId": "parse:policy:1",
    "page": 1,
    "chunkId": "chunk:policy:1",
    "blockPath": "p1/b1"
  }
]
JSON

echo "policy-qa artifact emitted"
