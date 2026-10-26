---
type: index
status: active
lifecycle: active
created: 2026-08-24
updated: 2026-10-26
---


# AI

## Purpose

Define how Claude Code interacts with Project OS.

## Main Areas

- [[AI-Context-Index]]
- [[Current-Context]]

## Survey Mode

entry-points

Modes are defined by [[Knowledge-OS/Protocols/Repository-Survey-Protocol]].

- `entry-points` — survey outward from the system's edges without asking.
- `budgeted` — present a reading plan and wait for approval.

Change the value above to switch. It applies to surveys only, not to ordinary Task work.

## Session Closing Ritual

At the end of a working session, run all four parts below. Answer from this session's own record; do not manufacture content to fill a slot. `/mv-close` runs this section, and this section is the only statement of the ritual.

**Part 1 — what the record does not already say.**

1. What did this session establish that `git log` and the notes it changed do not already say?
2. What went undocumented that was worth documenting?

Empty is the normal answer. A commit message and a changed note already record what happened; restating them makes a journal, not knowledge. Each non-empty answer becomes one `Finding` under `Project-OS/03-Development/Findings/`, in the shape [[Project-OS/Templates/Finding]] and `/mv-note` produce: one line of body, named after what it says.

- **Link it in the same edit:** one `affects:: [[…]]`, or `related-to:: [[…]]` when the connection is weaker ([[Knowledge-OS/Schema/Relationship-Types]]), naming what the observation is of — usually the Task. `orphaned-note` reports a Finding nobody links to.
- **If nothing in the vault is its subject**, it is about the operating system: it goes to `Backlog.md` at the vault root (create it if absent), not into a Finding.
- There is no "what's next?" question: Part 3 derives the next Task from Task status.

Then ask the human, in one message: for each proposed Finding, which was done — `read` / `ran` / `used` / `confirmed` — and whether there is anything else to add, both in the project's language ([[Knowledge-OS/Rules/Communication-Rules]]). The action maps to `evidence` through `evidenceActionMap` in `Knowledge-OS/Schema/schema.json`; there is no default, and an unanswered question leaves the field absent, which the validator then refuses. A non-empty answer to the last question becomes its own Finding.

**Part 2 — close out the Task and its Epic**, every time a Task reached `done` this session.

1. In the Task: `lifecycle: active`, `evidence` per `evidenceActionMap` (you ran the work, so normally `L2`), `created` if absent, `updated` to today.
2. `source: [{path: <path>, commit: <commit>}]` for the files the Task changed. The commit must be the one that contains the change: commit first and then write `source`, or correct the hash in a following commit — never with `git commit --amend`, which changes the hash being recorded.
3. Read the parent Epic. If every `contains::` Task is `done` or `cancelled`, set `status: done`; otherwise `status: active`. If it is still `lifecycle: draft`, promote it in the same edit — `lifecycle: active`, `evidence` (normally `L2`), `updated` — per [[Knowledge-OS/Protocols/Knowledge-Maintenance-Protocol]]. If the promotion makes `blocking-uncertainty-on-active` fire, report it: the gate is working. That rule checks the note a ledger row links to, not the Tasks an Epic contains, so a row should link the Tasks it blocks.
4. Run `node "Knowledge-OS/Tools/mv.cjs" validate-vault` and report the result. `lifecycle-behind-status` or `epic-status-behind-tasks` here means a step above was skipped.

**Part 3 — hand the work over, always.** What the next session needs goes where everyone on the project reads it — people and agents alike — and nothing here depends on how the team uses branches.

1. Run `node "Knowledge-OS/Tools/mv.cjs" task-lookup` from the vault root, even if nothing seems to have changed. It names the Task this working copy is on, the free Tasks, the Tasks taken here or on any branch not merged into `HEAD`, and the next one by `tasks.next` in `mvos.config.json`: `lowest-number` (the default, and what `tasks.keying: sequence` implies) offers the lowest-numbered free Task; `explicit` (what `tasks.keying: external` implies) offers none — Tasks named by a tracker's keys carry no order, so a human names the next one.
2. If this session worked on a Task that is still open, rewrite its `## Progress` section, adding it if the note has none: what is done, where the work stopped, the next concrete step, and what the next session must not have to find out again. Whoever picks the Task up next starts there. What the Task needs — its Architecture, Decisions, Research and code — goes in the Task's own sections, not in Current Context.
3. If the Task reached `done` or `cancelled` in Part 2, release this working copy's cursor: `node "Knowledge-OS/Tools/mv.cjs" task-lookup --release`.
4. In [[Current-Context]], rewrite a section only if this session changed what it says: `Active Epics` when an Epic changed status; `Required Architecture`, `Relevant Decisions`, `Relevant Research` or `Relevant Code` when the project's architecture, decisions, research or real behaviour changed; `Open Questions` when a question for the owner was raised or answered. Current Context holds only what the whole project shares. Which Task is next is not written into it: the lookup derives it, per working copy, every time.
5. Delete `.claude/budget.json` if it exists — at the project root, one level above the vault when embedded — per [[Knowledge-OS/Protocols/Context-Selection-Protocol]] §2. It was drawn for the work that just closed.

**Part 4 — metrics snapshot, always.** From the vault root:

```
node "Knowledge-OS/Tools/mv.cjs" context-metrics --write --session <id> --label <class>
```

- `<id>` is the most recently modified transcript in `~/.claude/projects/<repo-slug>/`. Always name it; never rely on the default selection.
- `<class>` is `task` for backlog work, `maintenance` for work on the operating system itself. Name the choice in the summary.
- The transcript cannot include this ritual's own calls, so the row slightly undercounts the session.
- `NOTE vault reached only through the shell` means the file-tool columns are unmeasured, not zero; pass it on as it stands.

**Close** by listing the Findings written (or saying plainly that none were needed), saying which Task's Progress was rewritten and which Current Context sections changed (or that none did), whether a cursor was released and a budget cleared, and reporting the metrics row: session id, Mean, label.

## Taking a Task

A Task is taken by its status, and git shares the status. Nobody's name is recorded: the commit that changed the status already says who.

1. Before the first edit for a free Task, take it in this working copy: `node "Knowledge-OS/Tools/mv.cjs" task-lookup --take <Task>`. The cursor lives inside git's own directory — one per worktree, never committed.
2. Set the Task's `status: in-progress`. Others see the claim once that change is committed and reaches a branch they fetch; pushing the branch is enough, merging is not needed. Until then nobody else can see it.
3. `--take` refuses a Task taken anywhere else. `--force` is for one case only: this working copy's own unfinished Task whose cursor was lost — a new clone, or a Task taken before the cursor existed. When that is not certain, ask the human first.
4. A taken Task reported as possibly abandoned — unchanged for `tasks.staleDays` days, 14 by default — is a question for the owner, not a Task to take.

## Current Context from before os-v8

Until os-v8, [[Current-Context]] held one working copy's session state — `Current Epic`, `Current Task`, `Current Goal` — and every close rewrote it, so two people on two branches conflicted there at every merge. A note that still has `## Current Task` or `## Current Goal` is reported by the validator (`current-context-old-shape`) and by `task-lookup`. Move it once, with the owner:

1. Propose a numbered list: for each part of `Current Task` and `Current Goal`, where it goes — the Task's own sections or its `## Progress` (what that Task needs), `Open Questions` (what the owner decides for the project), or nowhere, because the lookup or git now says it (which Task is next, what was merged).
2. Apply each item only after the owner approves it. Nothing is deleted before what it says has a place; an item without a clear place stays where it is.
3. If `Current Task` names a Task this working copy is on, take it: `task-lookup --take <Task>`, with `--force` when it is already `in-progress`.
4. Remove the two sections, rename `Current Epic` to `Active Epics`, add `Open Questions` if absent, and commit the move as one commit, so it can be reverted as one.
5. Run the validator: `current-context-old-shape` is gone.

## Governance

Behavior is defined by Knowledge OS, not here:

- [[Knowledge-OS/Rules/Brain-Rules]]
- [[Knowledge-OS/Rules/AI-Governance]]
- [[Knowledge-OS/Rules/Communication-Rules]]
- [[Knowledge-OS/Protocols/Context-Selection-Protocol]]

Record here only what is specific to this project. Do not restate Knowledge OS rules.

## Principle

Claude should maintain project knowledge while respecting human ownership of strategic decisions.
