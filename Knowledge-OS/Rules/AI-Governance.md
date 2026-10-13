---
type: rule
status: active
lifecycle: active
---
# AI Governance

Claude may act autonomously within the current Task and established project constraints.

## May

- inspect relevant project knowledge and repository code;
- select task-relevant context;
- implement within the defined scope;
- create or update task-related knowledge;
- record verified discoveries;
- propose decisions or architectural changes.

## Must

- follow accepted Decisions and current Architecture;
- preserve established constraints;
- verify assumptions against project knowledge or repository evidence;
- keep changes within the current Task scope;
- surface conflicts instead of resolving them silently;
- check for an accepted Decision governing how work is carried out — branching, commits, review — before the first action of that kind in a session, not after;
- promote an accepted correction to how work is carried out into this file or into Decisions before the session ends — a correction that lives only in Claude's own session memory does not exist for any other session or agent;
- treat any write outside the vault and its repository — a host project's `CLAUDE.md`, its `.claude/`, its `.gitignore` — as requiring explicit approval per class, and never as a side effect of another task; see [[Knowledge-OS/Protocols/Deployment-Protocol]];
- verify, before marking a Task `done`, that its branch is actually merged per the project's accepted branching Decision — a status update is not a substitute for the merge it describes.

## Must Not

- invent project facts;
- accept knowledge proposed by an external system as though the project established it: a proposal arrives at `lifecycle: draft` and stays there until a human promotes it per [[Knowledge-OS/Protocols/Knowledge-Promotion-Protocol]]. Automating that acceptance — for any provider, present or future — is a change to how knowledge becomes true here, and needs an explicit Decision rather than a code change;
- silently change accepted Decisions;
- silently change Architecture;
- expand Task scope;
- promote assumptions as project knowledge;
- overwrite unrelated knowledge;
- treat generic knowledge as project-specific fact;
- start the next Project OS task without the human owner's explicit initiation, even when the current task closes cleanly.

## Approval

Explicit approval is required to:

- change an accepted architectural Decision;
- introduce a breaking architectural change;
- expand the Task beyond its defined scope;
- replace an established project constraint.

When approval is required, stop at the decision boundary and ask.

## Connectivity

Claude reaches the vault through a live connection. If that connection is lost mid-session:

- stop all work on project knowledge and implementation immediately;
- do not continue from memory — the vault may have changed during the gap, including from a human editing concurrently;
- do not guess at current file state or blindly repeat the last action;
- resume only once a read against the vault verifiably succeeds again;
- re-orient from current vault state on resume — do not assume the pre-disconnect state still holds.
