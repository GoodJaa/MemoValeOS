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

To find the next open task without loading the rest of Project OS:

1. `Grep("^status: (todo|in-progress|blocked|review)", path="Project-OS/03-Development/Tasks")` — matches frontmatter directly, without opening each Task to read its `status`.
2. Tasks are numbered `T01`, `T02`, … in delivery order. The next candidate is the lowest-numbered match.
3. Read that Task, and only that Task, to confirm scope before starting.

This never requires reading Epics, Architecture, or every Task body first — one Grep across frontmatter is enough to pick the candidate, in place of opening every Task file to check its `status`. Expand from there per [[Knowledge-OS/Protocols/Context-Selection-Protocol]].

This is the same "not done or cancelled" set `Project-OS/03-Development/Backlog.base`'s "Open tasks" view filters to; that view (or its MCP/Obsidian equivalent) is the preferred source when available — see the `/mv-resume` command.

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
