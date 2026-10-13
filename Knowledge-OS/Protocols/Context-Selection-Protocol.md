---
type: protocol
status: active
lifecycle: active
created: 2026-08-24
updated: 2026-09-14
---
# Context Selection Protocol

Select the minimum context required to complete the current Task safely.

## 1. Identify Task

Determine:

- current Task;
- parent Epic;
- task scope;
- expected result.

Do not begin broad knowledge exploration.

## 2. Declare a Retrieval Budget

Before reading anything, state:

- **Target facts** — what must be known to act correctly.
- **Entry points** — which entities or files are expected to hold them.
- **Stop condition** — what makes the search complete.

Then read against that budget.

- Reading beyond the budget requires a reason tied to the Task.
- A target fact that cannot be found becomes an uncertainty, not a guess.
- If the budget was wrong, restate it rather than drifting.

A stop condition declared in advance is a boundary. A stop condition judged afterwards is a preference.

### Writing the budget down

Write the budget to `.claude/budget.json` at the start of the Task, before the first read:

```json
{
  "task": "T14-Function-Analyzer",
  "targetFacts": ["what shape the analyzer returns", "how T13 resolved specifiers"],
  "entryPoints": ["src/analyzer/", "MemoValeOS/Project-OS/03-Development/Tasks/T14-Function-Analyzer.md"],
  "stopCondition": "the signature and its test cases are known"
}
```

`task` is the Task's file name without `.md` — that is what lets a stale budget be recognised. `entryPoints` are paths relative to the project root, the directory holding `.claude/`; a directory covers everything under it. When the vault is embedded in a project, vault paths therefore carry its folder (`MemoValeOS/Project-OS/…` above); when the vault is the repository root, they do not. A `PreToolUse` hook reads this file on every `Read`/`Grep`/`Glob` and records whether a budget existed and whether the path was inside it; `context-metrics.mjs` reports the totals. Nothing is blocked — the log exists to find out how often the discipline actually holds, which was unmeasured through the first twelve Tasks.

Rewrite the file when the budget legitimately changes, rather than leaving a stale one in place: a budget from the previous Task scores this Task's reads against a boundary drawn for different work. The `task` field is what makes a stale budget visible.

**Delete the file when the Task closes.** A budget outlives the work it was drawn for otherwise, and the next session's reads are scored against a boundary that no longer means anything — which has happened: a budget naming a Task already `done` scored eighteen of nineteen reads as outside it. The file is a per-session artifact, gitignored alongside the audit log, so removing it loses nothing; an absent budget is recorded honestly as `undeclared`, while a stale one is recorded as a violation that did not occur. `/mv-close` does this as part of the closing ritual, and `context-metrics.mjs` reports a budget whose Task is already `done` when it was not.

A search (grep or similar) returns candidates, not a reading list.

- Filter matches against the current Task, its parent Epic, and neighboring Tasks before opening any of them.
- Opening every match without this filter is not a wider budget — it is no budget.
- Name what was filtered out and why; an unnamed omission is indistinguishable from one that never happened.
- This binds a delegated subagent exactly as it binds Claude directly: delegating the search does not delegate the budget.

## 3. Load Entry Context

Start with:

1. current Task;
2. parent Epic when one exists;
3. directly required Architecture;
4. Decisions that constrain the current Task — its subject matter, and how any task's work is carried out (branching, commits, review).

Use [[Context-Index]] to locate relevant project areas.

Do not assume every item in the list is required.

Apply [[Rules/Context-Rules]] before loading each item.

## 4. Expand

Expand only when current context is insufficient.

For each candidate entity:

1. determine whether it is `required`, `conditional` or `supporting`;
2. apply the condition when one exists;
3. load only relevant context;
4. reassess whether further context is necessary.

Follow relevant relationships to:

- Architecture;
- Decisions;
- Research;
- affected project entities;
- repository evidence.

Prefer the closest relevant source.

## 5. Conditional Context

Load conditional knowledge only when its condition applies.

Examples:

- parser research → when changing parser behavior;
- performance research → when optimizing performance;
- architectural Decision → when changing the affected architecture.

Do not load conditional context by default.

## 6. Verify

Before implementation, confirm:

- Task scope is understood;
- applicable constraints are known;
- relevant Architecture is understood;
- required Decisions are known;
- unresolved assumptions are identified.

Resolve uncertainty by inspecting the most specific available source.

## 7. Stop

Stop context expansion when Claude can:

- understand the Task;
- respect applicable constraints;
- follow the relevant Architecture;
- implement or investigate safely.

Do not continue loading related knowledge without a task-relevant reason.

## 8. Conflict

If relevant sources conflict:

1. identify the conflict;
2. inspect the most authoritative available evidence;
3. do not silently rewrite project knowledge;
4. escalate when the conflict requires a project decision.

## 9. Context Boundary

Do not load:

- unrelated Project OS areas;
- an entire area because part of it is relevant;
- generic knowledge already known to Claude;
- historical or archived knowledge without a relevant reason.

## Principle

Task → minimal context → work → evidence → knowledge update.

Context is pulled by the Task, not pushed onto it.
