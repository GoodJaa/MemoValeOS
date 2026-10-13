---
description: Resume work — after a normal session gap, or after reconnecting from an Obsidian/MCP disconnection
allowed-tools: Read, Glob, Grep, Write(.claude/budget.json)
---

Resolve the vault root first (sibling `Knowledge-OS`/`Project-OS` folders; ask if not found).

If this is a resume after losing and regaining the vault connection: per `Knowledge-OS/Rules/AI-Governance.md`'s Connectivity section, the prior session's assumptions do not carry over. Say so explicitly, and re-orient entirely from what you read below rather than from anything remembered from before the gap.

Read, in this order, without reading anything else yet:

1. `Project-OS/06-AI/Context/Current-Context.md` — current Epic, Task, and Goal.
2. `Project-OS/04-Research/Uncertainties.md` — filter to rows with `Status: open` and `Blocking: yes`.
3. `Project-OS/03-Development/Backlog.base` — read its filter definitions for the "Open tasks" and "Blocked" views (unless a live query tool for `.base` files is available in this session, in which case prefer that over reconstructing them by hand). To reconstruct "Open tasks" without a live query tool: `Grep("^status: (todo|in-progress|blocked|review)", path="Project-OS/03-Development/Tasks")` per [[Project-OS/03-Development/Development]]'s "Finding the Next Task" — one Grep across frontmatter, not opening each Task. Filter that same result to `status: blocked` for the "Blocked" view.

Only after those three are read: declare a retrieval budget per `Knowledge-OS/Protocols/Context-Selection-Protocol` — target facts, entry points, stop condition — before reading anything further (e.g. the parent Epic, if the current Task needs more context than Current Context.md gives).

Finish with exactly one concrete next step.

If the current Task is gated by an open, blocking uncertainty, that next step must be to surface the uncertainty to the human as a decision for them to make (per its `Resolution source` column) — do not attempt to resolve it yourself.
