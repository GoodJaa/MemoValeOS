---
description: Install MemoValeOS into this project — personal (plugin, no tracked file changes) or team (copies) — or take it out; you plan, the owner applies
argument-hint: "[--local|--team] [--uninstall] [--exclude-host-claude-md] [--only <classes>]"
allowed-tools: Read, Bash(node:*), Bash(git:*)
---

Install the OS layer into the project root that hosts this vault, or remove it. This is not knowledge bootstrap — `/mv-init` and `/mv-survey` do that, and they assume what this command puts in place.

Read `Knowledge-OS/Protocols/Deployment-Protocol.md` in full before acting. Its wording governs what counts as compliant here; do not follow it from memory.

## Plan, always — and only plan

```
node "<vault-root>/Knowledge-OS/Tools/mv.cjs" adopt $ARGUMENTS
```

This writes nothing. It prints which root and which mode it took and why, a census of what the project already has, and a numbered list of what it proposes. Relay that output **verbatim** — the human decides from it, and a summary is not the list.

If it refuses (a vault with its own `.git` inside another repository, a vault below the top of its repository, or no mode chosen), relay the refusal and ask which option the human wants. For a vault below the top, the question is which folder they start Claude in. Do not choose one.

## Hand the apply to the owner

Do not run `--apply` yourself. The plan ends with the exact command that carries it out — give it to the owner to run in their terminal, or as `! <command>` in this session. Installing writes into `.claude/` and `.git/`, which are protected paths for an assistant, and the personal install also needs `claude plugin …`, which changes Claude Code's own configuration. Those are the owner's to do, and the plan prints them ready to paste.

The two modes, for the owner's choice:

- `--local` — one person's install in a project the team owns. Nothing tracked changes: the commands come as the plugin `mv` (`/mv:check`, `/mv:close`…), the entry point is `.claude/rules/memovaleos.md`, and the vault and the budget files go into `.git/info/exclude`.
- `--team` — the whole team uses the OS. Copies in `.claude/commands/` (`/mv-check`…), the hook in `.claude/settings.json`, a redirect in `CLAUDE.md`, lines in `.gitignore`.

When the owner says it is done, re-run the plan: "Nothing to change" (or only the plugin step, until they run it) confirms it.

## The one step the script cannot finish

If a team install found the project's own `CLAUDE.md`, the script put the redirect above it, left its body in place, and copied it verbatim to `Project-OS/Inbox/Adopted CLAUDE.md`. Deciding which of those instructions is a Decision, which is Architecture, and which is project convention is judgement, and the script has none.

That distribution is yours to propose:

1. Read `Project-OS/Inbox/Adopted CLAUDE.md` — or, in a personal install, the project's own `CLAUDE.md` when the owner wants its rules in the vault.
2. Propose a numbered distribution — each item naming the target entity type and the destination note.
3. Apply nothing without per-item approval. An instruction whose home is unclear stays in the Inbox rather than being filed somewhere plausible.

A rule the team already follows becomes a Decision with `origin: inherited` and `source` naming the host file and the commit you read it at (`git log -1 --format=%h -- CLAUDE.md`), `status: proposed`, `lifecycle: draft`. When the owner confirms a rule as the project's, that is one edit: `status: accepted`, `lifecycle: active`, `evidence: user-provided`, `ratified: <today>` — no L2 needed (`Knowledge-OS/Schema/Evidence-Schema.md`, "A Decision inherited from the host").

In a personal install, once the rules are in the vault, offer the owner `adopt --apply --local --exclude-host-claude-md`: the team's `CLAUDE.md` then stops loading in their sessions, so the same rules are not in context twice. It refuses while no inherited Decision cites the file.

## Then verify

```
node "<vault-root>/Knowledge-OS/Tools/mv.cjs" adopt --verify
node "<vault-root>/Knowledge-OS/Tools/mv.cjs" validate-vault
```

Report both as printed. Then point at the next step: `/mv-init` for a new project, `/mv-survey` for an existing codebase.

## Taking it out

`/mv-adopt --uninstall` plans the removal: the hook entry before the hook file, the plugin before its marketplace, our blocks out of files the project owns, the install record last. Only what is provably ours goes; a file edited since install is refused without `--yes`. The vault itself is never removed. The owner applies it, as above.

## What this command must never do silently

- Overwrite or remove any file not named `mv-*`, the hook, or `.claude/rules/memovaleos.md`, or any text outside our markers. Everything else belongs to the host project.
- Modify `.claude/agents/`.
- Write a `settings.json` it could not parse — the script refuses, and so do you.
- Run `git add` or commit. Leave the tree for the human to inspect.
- Touch `~/.claude/commands/`. A user-level copy is visible in every project and drifts from the repository at the first edit.
