---
description: Resume work — after a normal session gap, or after reconnecting from an Obsidian/MCP disconnection; with a key, on that Task
argument-hint: "[<task key>]"
allowed-tools: Read, Glob, Grep, Write(.claude/budget.json), Bash(node:*)
---

Resolve the vault root first (sibling `Knowledge-OS`/`Project-OS` folders; ask if not found).

If this is a resume after losing and regaining the vault connection: per `Knowledge-OS/Rules/AI-Governance.md`'s Connectivity section, the prior session's assumptions do not carry over. Say so explicitly, and re-orient entirely from what you read below rather than from anything remembered from before the gap.

Run, then read, in this order, without reading anything else yet:

1. `node "Knowledge-OS/Tools/mv.cjs" task-lookup` from the vault root — the Task this working copy is on, the free Tasks, the Tasks taken here or on branches not merged into `HEAD`, and the next one. Which Task is this copy's comes from here, not from Current Context or memory.
2. `Project-OS/06-AI/Context/Current-Context.md` — what the project shares: active Epics, the architecture, decisions, research and code that matter now, open questions for the owner.
3. `Project-OS/04-Research/Uncertainties.md` — filter to rows with `Status: open` and `Blocking: yes`.
4. The Task: this working copy's Task if the lookup names one — its `## Progress` section first; otherwise the next one the lookup offers. When it offers none (`tasks.next: explicit`, or nothing free), ask the human which Task, from the free ones it lists; do not pick.

**With an argument** (`/mv-resume PRJ-101`), the Task is the one whose `key` is that value or whose file name starts with it, and it replaces the choice in step 4. If no Task has that key, say so and offer `/mv-task-import <resource> PRJ-101` when a tracker is reachable through MCP, or `paste` when it is not: the Task is created from the tracker's text, not invented from the key.

**If the lookup reports Current Context in the old shape** (`## Current Task`, `## Current Goal`), the next step is to propose moving it per `Project-OS/06-AI/AI.md`, "Current Context from before os-v8" — before any Task work.

**If this working copy is on no Task but the lookup lists Tasks taken here**, one may be this copy's own unfinished work from before the cursor existed or after it was lost. Ask the human; take it with `task-lookup --take <Task> --force` only on their word.

Only after those are read: declare a retrieval budget per `Knowledge-OS/Protocols/Context-Selection-Protocol` — target facts, entry points, stop condition — before reading anything further (e.g. the parent Epic, if the Task needs more context than its note gives).

Finish with exactly one concrete next step. If that step starts a free Task, it begins by taking it, per `Project-OS/06-AI/AI.md`, "Taking a Task".

If the Task is gated by an open, blocking uncertainty, that next step must be to surface the uncertainty to the human as a decision for them to make (per its `Resolution source` column) — do not attempt to resolve it yourself.
