#!/usr/bin/env bash
set -euo pipefail

mkdir -p out

cat > out/meeting-actions.json <<'JSON'
{
  "kind": "meeting_actions_v1",
  "actions": [
    {
      "id": "A-1",
      "owner": "ops",
      "task": "publish release checklist",
      "dueDate": "2026-03-05",
      "state": "todo"
    },
    {
      "id": "A-2",
      "owner": "qa",
      "task": "verify kill-resume report",
      "dueDate": "2026-03-06",
      "state": "todo"
    }
  ]
}
JSON

cat > out/follow-through.stub.json <<'JSON'
{
  "kind": "meeting_follow_through_stub_v1",
  "launcher": "enqueueActorTick",
  "actorIdTemplate": "actor:ops-review",
  "firstPendingSeq": 1,
  "note": "mailbox commands are forbidden; control stays in /skill parser"
}
JSON

echo "meeting-to-actions artifacts emitted"
