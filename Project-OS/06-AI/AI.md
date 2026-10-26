---
type: index
status: active
lifecycle: active
created: 2026-08-24
updated: 2026-10-25
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

**Part 3 — refresh Current Context, always.**

1. Re-run the lookup `/mv-resume` and [[Project-OS/03-Development/Development]] use — `Grep("^status: (todo|in-progress|blocked|review)", path="Project-OS/03-Development/Tasks")` — for the next open Task and its Epic. Which one is next comes from `tasks.next` in `mvos.config.json`: `lowest-number` (the default, and what `tasks.keying: sequence` implies) takes the lowest-numbered match; `explicit` (what `tasks.keying: external` implies) keeps the Task Current Context names while it is still open, and otherwise asks the owner which — Tasks named by a tracker's keys carry no order, so do not pick one.
2. Rewrite `Current Epic`, `Current Task` and `Current Goal` in [[Current-Context]] to match that lookup.
3. Rewrite `Relevant Code` only if this session changed what has real behaviour; leave `Required Architecture`, `Relevant Decisions` and `Relevant Research` unless this session changed them.
4. Re-run the lookup even if nothing seems to have changed.
5. Delete `.claude/budget.json` if it exists — at the project root, one level above the vault when embedded — per [[Knowledge-OS/Protocols/Context-Selection-Protocol]] §2. It was drawn for the work that just closed.

**Part 4 — metrics snapshot, always.** From the vault root:

```
node "Knowledge-OS/Tools/mv.cjs" context-metrics --write --session <id> --label <class>
```

- `<id>` is the most recently modified transcript in `~/.claude/projects/<repo-slug>/`. Always name it; never rely on the default selection.
- `<class>` is `task` for backlog work, `maintenance` for work on the operating system itself. Name the choice in the summary.
- The transcript cannot include this ritual's own calls, so the row slightly undercounts the session.
- `NOTE vault reached only through the shell` means the file-tool columns are unmeasured, not zero; pass it on as it stands.

**Close** by listing the Findings written (or saying plainly that none were needed), confirming Current Context was refreshed and whether a budget was cleared, and reporting the metrics row: session id, Mean, label.

## Governance

Behavior is defined by Knowledge OS, not here:

- [[Knowledge-OS/Rules/Brain-Rules]]
- [[Knowledge-OS/Rules/AI-Governance]]
- [[Knowledge-OS/Rules/Communication-Rules]]
- [[Knowledge-OS/Protocols/Context-Selection-Protocol]]

Record here only what is specific to this project. Do not restate Knowledge OS rules.

## Principle

Claude should maintain project knowledge while respecting human ownership of strategic decisions.
