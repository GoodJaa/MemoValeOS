---
type: index
status: active
lifecycle: draft
---


# Development

How work moves from knowledge to implementation.

## Workflow

```
Research
 ↓
Decision
 ↓
Architecture
 ↓
Epic
 ↓
Task
 ↓
Implementation
 ↓
Test
 ↓
Discovery
 ↓
Knowledge Update
```

Open work is not tracked by a separate hand-kept list; the Tasks themselves are the backlog.

## Finding the Next Task

To find the next Task without loading the rest of Project OS:

1. `node "Knowledge-OS/Tools/mv.cjs" task-lookup` from the vault root. A Task is open unless it is `done` or `cancelled`, free while it is `todo`, and taken once work has started — here, or on any branch not merged into `HEAD`.
2. Tasks are numbered `T01`, `T02`, … in delivery order. The next one is this working copy's own Task while it is open, otherwise the lowest-numbered free Task.
3. Read that Task, and only that Task, to confirm scope before starting; take it per [[AI]], "Taking a Task".

This never requires reading Epics, Architecture, or every Task body first. Expand from there per [[Knowledge-OS/Protocols/Context-Selection-Protocol]].

`Project-OS/03-Development/Backlog.base`'s "Open tasks" view filters the same "not done or cancelled" set, but it sees this working copy only: a Task taken on someone else's branch still reads `todo` there.

## Findings

Cheap, dated captures live under `Project-OS/03-Development/Findings/`, one file per `Finding`: one line of body, and one relationship line naming what it is about (`affects::` or `related-to::`). `/mv-note` and the closing ritual in [[AI]] write them. See [[Knowledge-OS/Schema/Knowledge-Types]] for the type and [[Knowledge-OS/Rules/Promotion-Rules]] for what happens to one afterward.

## Rules

- work task-first;
- avoid uncontrolled scope expansion;
- record significant discoveries;
- update knowledge after meaningful changes.

## Related

- [[Project-OS/03-Development/MVP]]
- [[Project-OS/02-Architecture/Architecture]]
