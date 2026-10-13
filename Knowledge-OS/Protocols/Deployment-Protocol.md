---
type: protocol
status: active
lifecycle: active
---
# Deployment Protocol

Install the OS layer's files into a project that already exists.

This protocol governs **files**, not knowledge. [[Project-Initialization-Protocol]] and [[Repository-Survey-Protocol]] establish what a project knows; both assume the files this protocol puts in place. The order is: deploy, then initialize or survey.

## 1. Establish the Two Roots

The **vault** is the directory holding sibling `Knowledge-OS/` and `Project-OS/`. The **project root** is the git toplevel that contains it.

Both must be established before anything is written. A deployment into the wrong working tree is the failure this protocol exists to prevent, and it is not reliably reversible — the host's own files are involved.

When the vault is itself the git toplevel, the two coincide. That is the standalone layout, and it is legitimate: it is what a clone of the distribution repository looks like.

If either root is ambiguous, ask. Do not infer one from the other.

## 2. Take a Census Before Proposing Anything

Report what the target already has, as fact, before naming a single change:

- `CLAUDE.md` — absent, present without the redirect, or present with it;
- `.claude/commands/` — how many files, how many in the `mv-` namespace;
- `.claude/hooks/`, `.claude/agents/` — present or absent, how many;
- `.claude/settings.json` — absent, valid JSON, or unparseable.

A census is not a formality. The whole difference between installing into an empty directory and installing into somebody's working project is what this step finds.

## 3. Propose, Then Apply by Class

Deployment is five classes: `commands`, `hooks`, `settings`, `claude-md`, `gitignore`. They carry different risk and are approved separately — `settings` and `claude-md` modify files the project already owns, the others add files it does not have.

`Knowledge-OS/Tools/adopt.mjs` performs this. Its default mode is a plan that writes nothing; `--apply --only <classes>` carries out what was approved. Relay the plan as printed rather than summarizing it: the human decides from that list, and a summary is not the list.

Approval for one class is not approval for the next.

## 4. The Reserved Namespace

`mv-` is reserved. A file under that prefix in `.claude/commands/` is this system's to deploy and replace; everything else in the target's `.claude/` belongs to the host project and is never written, never renamed, never deleted.

`.claude/agents/` is not touched at all, under any class.

A file in the `mv-` namespace that differs from its source is a stale copy of ours, but it is still a file somebody may have edited deliberately. Replacing it is opt-in.

## 5. What Must Never Happen Silently

- Overwriting any file outside the `mv-` namespace.
- Writing a `settings.json` that could not be parsed. Refuse the step, report the parse error, leave the file byte-identical, and continue with the other classes.
- Deleting anything. This protocol has no uninstall path.
- Staging or committing. The tree is left dirty for a human to inspect.
- Writing into `~/.claude/commands/`. A user-level copy is visible in every project and drifts from the repository at the first edit.

## 6. An Existing CLAUDE.md Is Knowledge

When the target already has a `CLAUDE.md` of its own, it is often the only written record of how that project works. It is not overwritten and not summarized.

The redirect is prepended between explicit markers, and the original body is moved **verbatim** to `Project-OS/Inbox/`, with a line naming where it came from and when.

Distribution stops there for the tool. Deciding which of those instructions is a Decision, which is Architecture, and which is project convention is judgement. Propose it as a numbered list and apply nothing without per-item approval. An instruction whose home is unclear stays in the Inbox: an unfiled note is honest, and a misfiled one is a false claim about what the project decided.

## 7. Verify by Running

Run `Knowledge-OS/Tools/validate-vault.mjs` and report what it prints.

A host project's own markdown is not this vault's to judge, and the validator no longer tries. If it nonetheless reports findings from a tree the host owns, that is a defect in the scoping rules — record it rather than silencing it with `.mvignore`.

`.mvignore` exists for what ownership rules cannot anticipate: a generated directory, a tree kept somewhere unusual. It may never exclude the OS layer, and a line in it that matches nothing is reported, because a stale suppression is how these files stop describing the tree they claim to describe.

## 8. Boundary

This protocol ends when the files are in place and the validator has been run. What the project knows is the next question, and a different protocol answers it.
