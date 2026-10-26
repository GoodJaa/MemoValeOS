---
type: protocol
status: active
lifecycle: active
updated: 2026-10-26
---
# Deployment Protocol

Install the OS layer's files into a project that already exists.

This protocol governs **files**, not knowledge. [[Project-Initialization-Protocol]] and [[Repository-Survey-Protocol]] establish what a project knows; both assume the files this protocol puts in place. The order is: deploy, then initialize or survey.

## 1. Establish the Two Roots

The **vault** is the directory holding sibling `Knowledge-OS/` and `Project-OS/`. The **project root** is where the OS is installed: what the human names, else what the install record (`<vault>/.mvos/install.json`) says an earlier deployment used, else the git toplevel that contains the vault.

Both must be established before anything is written. A deployment into the wrong working tree is the failure this protocol exists to prevent, and it is not reliably reversible — the host's own files are involved.

When the vault is itself the git toplevel and nothing above it is a repository, the two coincide. That is the standalone layout, and it is legitimate: it is what a clone of the distribution repository looks like.

When the vault is its own git repository *inside* another one, the root is ambiguous, and `adopt.mjs` refuses until it is named: `--project <dir>` for an install into that project, `--standalone` for a vault that is the project. Relay the refusal and ask; do not pick one. The first real installation took the vault for the project here and deployed into a folder Claude Code never reads.

The project root is the folder Claude Code is started in. When the vault sits below the top of its repository — a package of a monorepo — `adopt.mjs` refuses in the same way and offers both the repository root and the vault's folder: Claude Code reads `.claude/settings.json`, and with it the budget hook, only in the folder it is started in, and a session started in a package sees only that package. Ask the human where they start Claude; the answer is the `--project`.

Every apply writes the install record: the project root, the mode, each deployed file with its hash. From then on the root is not guessed again — by the deployment, the validator or `stale-check`.

If either root is ambiguous, ask. Do not infer one from the other.

## 2. Take a Census Before Proposing Anything

Report what the target already has, as fact, before naming a single change:

- `CLAUDE.md` — absent, present without the redirect, or present with it;
- `.claude/commands/` — how many files, how many in the `mv-` namespace;
- `.claude/hooks/`, `.claude/agents/` — present or absent, how many;
- `.claude/settings.json` — absent, valid JSON, or unparseable;
- where the project root came from, the install record, and whether the vault has its own `.git`;
- whether `CLAUDE.md` is tracked by git — a tracked one is shared with everyone who clones the project, and a personal install must not rewrite it;
- `CLAUDE.local.md`, `AGENTS.md`, `.claude/settings.local.json`, `.claude/skills/`, `.claude/rules/` — what the project already configures for its assistant;
- another knowledge system — `adopt.mjs` names the signs it finds (a memory bank, another tool's rules folder, hooks in `settings.json` that are not ours, a large `docs/` tree); §10 says what to do about one.

A census is not a formality. The whole difference between installing into an empty directory and installing into somebody's working project is what this step finds.

## 3. Choose the Mode

There are two kinds of host, and they want opposite things:

- **Personal** (`--local`): one person works with the OS in a project the team owns. No tracked file may change. The commands and the budget hook come as the Claude Code plugin `mv`, its marketplace the vault itself; the assistant's entry point is a file of ours, `.claude/rules/memovaleos.md`; the vault, that file and the budget artifacts go into `.git/info/exclude`, which git never shares. Commands are then `/mv:check`, `/mv:close`…
- **Team** (`--team`): the team adopts the OS together. Commands and the hook are copied into the project's `.claude/`, the hook is entered in `.claude/settings.json`, a redirect goes at the top of `CLAUDE.md`, and `.gitignore` learns the budget artifacts. Commands are `/mv-check`, `/mv-close`…

The mode is the human's to name. A mode already recorded, or a team install already in place, is kept. Otherwise the plan shows the recommended one with its reason — personal in a git repository, above all when `CLAUDE.md` is tracked — and applying refuses until a mode is named. Relay the recommendation; do not apply it on the human's behalf.

A project that is not a git repository has only the team mode: the personal install keeps itself out of git, and there is no git to keep it out of.

## 4. Propose, Then Hand Over the Apply

Each mode is a set of classes, approved separately: `commands`, `hooks`, `settings`, `claude-md`, `gitignore` for a team install; `plugin`, `rules`, `exclude` for a personal one. `settings` and `claude-md` modify files the project already owns, the others add files of ours.

`Knowledge-OS/Tools/adopt.mjs` performs this. Its default is a plan that writes nothing, and the plan ends with the exact command that applies it. Relay the plan as printed rather than summarizing it: the human decides from that list, and a summary is not the list.

**The apply is the owner's.** Installing writes into `.claude/` and `.git/`, which are protected paths for an assistant: a classifier refused those writes on the first real installation, and the owner had to make them by hand without being told which. A personal install also needs Claude Code's own commands (`claude plugin marketplace add`, `claude plugin install`), which change Claude Code's configuration. So the assistant plans and hands over: the command the plan prints, run by the owner in a terminal, or as `! <command>` in the session. The plan names every such step ready to paste, in the order it must run.

Approval for one class is not approval for the next.

## 5. The Reserved Namespace

`mv-` is reserved. A file under that prefix in `.claude/commands/` is this system's to deploy and replace, and so are the budget hook in `.claude/hooks/`, `.claude/rules/memovaleos.md`, and text between our markers in files the project owns. Everything else in the target's `.claude/` belongs to the host project and is never written, never renamed, never deleted.

`.claude/agents/` is not touched at all, under any class. Neither is `.claude/settings.local.json`: Claude Code writes it itself, and a personal install reaches it only through `claude plugin install`.

A file in the `mv-` namespace that differs from its source is a stale copy of ours, but it is still a file somebody may have edited deliberately. Replacing it is opt-in.

## 6. What Must Never Happen Silently

- Overwriting any file outside the namespace above.
- Writing a `settings.json` that could not be parsed. Refuse the step, report the parse error, leave the file byte-identical, and continue with the other classes.
- Deleting anything outside an uninstall (§8), and inside one anything not provably ours.
- In a personal install, changing any file git tracks. The install is checked by `git status` coming back empty.
- Staging or committing. The tree is left dirty for a human to inspect.
- Writing into `~/.claude/commands/`. A user-level copy is visible in every project and drifts from the repository at the first edit.

## 7. An Existing CLAUDE.md Is Knowledge

When the target already has a `CLAUDE.md` of its own, it is often the only written record of how that project works. It is not overwritten and not summarized.

The redirect is prepended between explicit markers, the original body stays where it was beneath it, and a **verbatim copy** goes to `Project-OS/Inbox/`, with a line naming where it came from and when. (Until 2026-10-26 this said "moved"; the tool has always copied, and the host's text was never removed.)

Distribution stops there for the tool. Deciding which of those instructions is a Decision, which is Architecture, and which is project convention is judgement. Propose it as a numbered list and apply nothing without per-item approval. An instruction whose home is unclear stays in the Inbox: an unfiled note is honest, and a misfiled one is a false claim about what the project decided.

A rule the team already follows becomes a Decision with `origin: inherited` and `source` naming the host file and the commit it was read at — `status: proposed`, `lifecycle: draft` until the owner confirms it is the project's rule. Confirmation is one edit: `status: accepted`, `lifecycle: active`, `evidence: user-provided`, `ratified: <date>`. It needs no `L2`: the rule's authority is that the team adopted it, which nothing running can show ([[Schema/Evidence-Schema]], "A Decision inherited from the host"). From then on `stale-source` reports the Decision whenever the team changes that file, which is the prompt to read the rule again and re-ratify it.

A personal install does not touch the project's `CLAUDE.md` at all; it goes on loading beside the rules file. Its instructions can be distributed the same way when the owner wants them in the vault. Once they are — inherited Decisions citing that file — the owner can stop it loading in their own sessions with `adopt.mjs --apply --local --exclude-host-claude-md`, which adds one `claudeMdExcludes` entry to `.claude/settings.local.json`. The tool refuses while no inherited Decision cites the file: hiding it then would take the team's rules out of context with nothing in their place. Offer it; do not apply it — like every apply, it is the owner's command.

## 8. Uninstall

The install record (`<vault>/.mvos/install.json`) names everything of ours, files by hash and blocks by marker. `adopt.mjs --uninstall` plans the removal from it, and the owner applies it, as for an install. The order is the one that cannot strand the host:

1. Claude Code's own steps first, printed for the owner: `claude plugin uninstall mv@memovaleos --scope local`, then `claude plugin marketplace remove memovaleos`.
2. The hook entry out of `.claude/settings.json` before the hook file goes. A hook named in settings with no file behind it fails on every read; the first real installation could not remove another system for exactly that reason.
3. Our files: commands, the hook, the rules file — each only if its hash matches the record, or it is identical to its source in `Dist/`. A file of ours that somebody has edited is refused without `--yes`.
4. Our blocks out of the project's files — the redirect and its blank line in `CLAUDE.md`, our lines in `.gitignore`, our block in `.git/info/exclude` — so the text around them comes back byte for byte. A file left holding nothing goes.
5. The record, last.

The vault is never removed, and neither is the copy of the host's `CLAUDE.md` in its Inbox: that is the owner's to delete.

## 9. Verify by Running

Run `Knowledge-OS/Tools/adopt.mjs --verify` — in a personal install it fails until the plugin is enabled — then `Knowledge-OS/Tools/validate-vault.mjs`, and report what each prints. For a personal install, `git status` coming back empty is part of the check.

A host project's own markdown is not this vault's to judge, and the validator no longer tries. If it nonetheless reports findings from a tree the host owns, that is a defect in the scoping rules — record it rather than silencing it with `.mvignore`.

`.mvignore` exists for what ownership rules cannot anticipate: a generated directory, a tree kept somewhere unusual. It may never exclude the OS layer, and a line in it that matches nothing is reported, because a stale suppression is how these files stop describing the tree they claim to describe.

## 10. Another Knowledge System Already Here

A project often has knowledge somewhere else already: a `docs/` tree, a wiki, a memory bank, another assistant's rules, skills and hooks, another knowledge system with its own commands. On the first real installation it was all of these at once — a tool that wrote task folders into `docs/`, ~3500 files of them, with its own hook and skills.

1. **Do not delete it, and do not switch it off.** It is the team's. Removing another system's files, hooks or settings is the owner's decision, made explicitly; propose it if it conflicts, never do it in passing. A hook removed from settings while its file stays, or the other way round, breaks every session.
2. **Name it in the vault.** One Resource from `Templates/External-Corpus.md` per body of knowledge: what it is, where, what it covers and how large it is, who writes it and with what, how current it is.
3. **Say whose instructions govern what.** By default the vault's protocols govern what is written into the vault, and the other system's instructions keep governing its own files. Where the two give conflicting instructions for the same act — where a task is recorded, which rule wins — ask the owner, and record the answer as a Decision rather than resolving it silently each session.
4. **Link, do not copy. Lift what outlives the task.** The corpus stays where it is and is linked. What outlives a single task — a decision, a boundary, a convention — is written into the vault as its own entity, citing the corpus file in `source`, so `stale-source` reports it when that file changes. Two copies of the same document drift, and the one in the vault would look authoritative.
5. **Keep the validator off it.** The validator judges only what the vault owns, so a foreign tree outside the vault is not checked. If the other system's markdown has to live inside the vault folder, exclude it with `.mvignore` — never the OS layer.

## 11. Boundary

This protocol ends when the files are in place, `--verify` and the validator have been run, and — for a personal install — git has nothing to report. What the project knows is the next question, and a different protocol answers it.
