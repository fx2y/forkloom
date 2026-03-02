---
name: meeting-to-actions
description: Convert meeting notes into action artifacts and durable follow-through queue stubs.
allowed-tools:
  - Read
  - Bash
---
# meeting-to-actions

## Setup
Control syntax stays in run command parsing (`/skill:`). Worker execution reuse is queue-only (`enqueueActorTick`). mailbox commands are forbidden.

## Inputs
- Meeting notes and context: `$ARGUMENTS`
- Optional owner map: [action template](references/action-template.md)

## Procedure
1. Parse notes into deterministic action rows.
2. Emit action artifact + follow-through queue stub through [action emitter](scripts/emit-meeting-actions.sh).
3. Keep control surface separate from worker queue; never post slash commands through ActorService mailbox text.

## Outputs (ARTIFACTS)
- `out/meeting-actions.json` (schema: [actions contract](assets/meeting-actions.schema.json))
- `out/follow-through.stub.json`

## Failure Modes + Recovery
- Missing owner/due-date data should be flagged per action with `state=needs_input`.
- If queue stub is absent, follow-through is not shippable.
