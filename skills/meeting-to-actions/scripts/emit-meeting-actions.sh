#!/usr/bin/env bash
set -eu
(set -o pipefail) 2>/dev/null && set -o pipefail || true

notes="${*:-ops:publish release checklist,qa:verify kill-resume report}"
mkdir -p out

NOTES="$notes" node <<'NODE'
const { createHash } = require("node:crypto");
const { writeFileSync } = require("node:fs");

const notes = process.env.NOTES ?? "";
const tokens = notes
  .split(",")
  .map((item) => item.trim())
  .filter((item) => item.length > 0);

const actions = tokens.map((token, index) => {
  const [ownerRaw, taskRaw] = token.split(":");
  const owner = (ownerRaw ?? "unassigned").trim() || "unassigned";
  const task = (taskRaw ?? token).trim();
  const due = new Date(Date.UTC(2026, 2, 5 + index));
  const dueDate = due.toISOString().slice(0, 10);
  return {
    id: `A-${index + 1}`,
    owner,
    task,
    dueDate,
    state: owner === "unassigned" ? "needs_input" : "todo",
  };
});

const digest = createHash("sha256")
  .update(JSON.stringify(actions))
  .digest("hex")
  .slice(0, 12);

writeFileSync(
  "out/meeting-actions.json",
  `${JSON.stringify(
    {
      kind: "meeting_actions_v1",
      actions,
    },
    null,
    2,
  )}\n`,
  "utf8",
);
writeFileSync(
  "out/follow-through.stub.json",
  `${JSON.stringify(
    {
      kind: "meeting_follow_through_stub_v1",
      launcher: "enqueueActorTick",
      actorIdTemplate: "actor:ops-review",
      firstPendingSeq: 1,
      requestDigest: digest,
      note: "mailbox commands are forbidden; control stays in /skill parser",
    },
    null,
    2,
  )}\n`,
  "utf8",
);
NODE

echo "meeting-to-actions artifacts emitted"
