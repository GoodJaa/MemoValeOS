---
description: Deploy MemoValeOS files into this project's root — commands, hook, settings, CLAUDE.md redirect
argument-hint: "[--apply] [--only commands,hooks,settings,claude-md,gitignore]"
allowed-tools: Read, Bash(node:*), Bash(git:*), Edit, Write
---

Deploy the OS layer's *files* into the project root that hosts this vault. This is not knowledge bootstrap — `/mv-init` and `/mv-survey` do that, and they assume the files this command puts in place.

Read `Knowledge-OS/Protocols/Deployment-Protocol.md` in full before acting. Its wording governs what counts as compliant here; do not follow it from memory.

## Run the planner first, always

```
node "<vault-root>/Knowledge-OS/Tools/adopt.mjs"
```

This writes nothing. It prints a census of what the target already has and a numbered list of what it proposes to change. Relay that list **verbatim** — the human decides from it, so summarizing it away defeats the step.

## Then apply, per class, only what was approved

```
node "<vault-root>/Knowledge-OS/Tools/adopt.mjs" --apply --only <classes>
```

Classes are `commands`, `hooks`, `settings`, `claude-md`, `gitignore`. Ask about each class the planner listed as changed, separately. A single blanket "yes" to everything is not the approval this command needs: the classes carry different risk, and `settings` and `claude-md` modify files the project already owns.

Do not pass `--apply` without naming `--only`, unless the human approved every listed class explicitly.

## The one step the script cannot finish

If the target had its own `CLAUDE.md`, the script prepends the redirect and moves the original body, verbatim, to `Project-OS/Inbox/Adopted CLAUDE.md`. It stops there on purpose — deciding which of those instructions is a Decision, which is Architecture, and which is project convention is judgement, and the script has none.

That distribution is yours to propose:

1. Read `Project-OS/Inbox/Adopted CLAUDE.md`.
2. Propose a numbered distribution — each item naming the target entity type and the destination note.
3. Apply nothing without per-item approval. An instruction whose home is unclear stays in the Inbox rather than being filed somewhere plausible.

## Then verify

```
node "<vault-root>/Knowledge-OS/Tools/validate-vault.mjs"
```

Report `OK` or the exact failure list. Then point at the next step: `/mv-init` for a new project, `/mv-survey` for an existing codebase.

## What this command must never do silently

- Overwrite any file not named `mv-*`. The `mv-` prefix is a reserved namespace; everything else belongs to the host project.
- Modify `.claude/agents/`. Those are the project's own.
- Write a `settings.json` it could not parse. A file that cannot be read cannot be safely rewritten — the script refuses, and so do you.
- Delete anything. There is no uninstall path.
- Run `git add` or commit. Leave a dirty tree for the human to inspect, as `/mv-sync` does.
- Touch `~/.claude/commands/`. A user-level copy is visible in every project and drifts from the repository at the first edit; `README.md` records what that cost once already.
