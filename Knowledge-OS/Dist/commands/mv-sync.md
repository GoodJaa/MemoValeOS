---
description: Deliver the OS layer from this project to the upstream MemoValeOS repository as a patch, without sharing this project's history
allowed-tools: Read, Bash(git:*), Bash(node:*), Bash(npm:*), Bash(ls:*), Bash(diff:*)
---

Deliver the OS layer — `Knowledge-OS/` (including `Knowledge-OS/Dist/`, the source of the commands and the hook; the project root's `.claude/` never travels itself), `Project-OS/Templates/`, `Docs/`, and whatever else `Knowledge-OS/os-manifest` names — from this project to the upstream MemoValeOS clone.

Read `Knowledge-OS/os-manifest` first. It is the definition of what travels, and it is the only one; do not decide from the shape of a path.

**Nothing of this project's history travels.** Upstream is a public repository; this project's Tasks, Findings, Decisions, plans and commit messages are its own. Delivery is a patch of the OS layer's content, applied and committed in upstream as a new commit. Never fetch this project into the upstream clone, never merge, cherry-pick or push one of its branches there, and never add it as a remote. Until os-v5 delivery went by `git subtree split`, and every sync published the whole vault directory's history; that is why upstream's history was rebuilt.

**Before anything, establish where both repositories are.** The vault root is the folder holding sibling `Knowledge-OS/` and `Project-OS/`. The upstream clone is a separate checkout of `GoodJaa/MemoValeOS` — `git remote -v` there names it. Ask if either is ambiguous rather than guessing; a delivery into the wrong working tree is the failure this command exists to avoid.

Both working trees must be clean apart from untracked files, and the OS-layer work here must be committed: only committed work travels. Stop and say so if either is not.

Find the previous delivery: the newest `os-vN` tag in this project (`git tag -l "os-v*"`). It marks this project's commit whose OS layer upstream already has, and it is the base of the patch. If there is none, stop and ask — guessing a base produces a patch against content upstream does not hold.

**Step 1 — build the patch, in this project.**

```
node "<vault dir>/Knowledge-OS/Tools/mv.cjs" os-patch --since os-vN --out <path outside both repositories>
```

Read the path list it prints. Every path must be OS layer: if a project note, a plan or source code appears, stop — the manifest is wrong, and the patch must not leave this machine.

**Step 2 — apply, in the upstream clone**, on a branch for this delivery (`sync/os-vN+1`) made from upstream's `master`:

```
git apply --3way --index <path to the patch>
```

A conflict means upstream changed an OS-layer file outside a delivery. That is a real disagreement about shared code, and the rule for it is that **this project is where the OS layer is developed** — take this side unless the file is a recorded permanent divergence (below). Resolve, `git add`, and check no file still holds conflict markers: `git grep -nE "^(<{7,}|>{7,})( |$)"`.

**Step 3 — carry the per-copy files by hand.** Some files are part of the system but each copy keeps its own, so `os-manifest` cannot list them: `upgrade.mjs` would overwrite a host project's own README, Obsidian settings and backlog with this project's. The manifest names them in a comment. For each, compare this project's version with upstream's and carry over what changed in the system, not in this project:

- `CLAUDE.md` — the vault's entry point. Normally identical in both copies; take this project's.
- `README.md` — written for people. Carry the sections that describe the system; rewrite every path for the standalone layout (no `<vault dir>/` prefix, `--vault-root` is the vault root, `npm install` runs in the vault); keep upstream's own sections on cloning and starting a new project; name this project as the source of any measurement, with its date.
- `.os-version` — bump it in both copies when the delivery closes a version (see `Docs/08-Distribution/08-4-Versioning-and-Changelog.md`).
- `.obsidian/app.json`, `.obsidian/templates.json` — take this project's.
- `Backlog.md` — the OS's open backlog; take this project's. `Backlog-Archive.md` stays here: it is this project's record of how entries were closed.

Never carried, not even by hand: `mvos.config.json` (this project's language and the language of its notes — upstream keeps its own, or none) and everything under `.mvos/` (`install.json`, this installation's record; `os-base.json`, the base of its next upgrade).

Then look at upstream's template `Project-OS`. It belongs to upstream and never travels, but `Project-OS/06-AI/AI.md` does, and it names sections of `Current-Context`, `AI-Context-Index` and Development that the template must still have. If the delivered `AI.md` names a section the template lacks, add it to the template, empty. If the validator now refuses something in the template, fix the template there.

**Step 4 — verify, from the upstream root, by running.**

```
npm install                                     # once: the tests' dev dependency (acorn)
node "Knowledge-OS/Tools/mv.cjs" os-check --skip docs-with-code
git grep -nE "^(<{7,}|>{7,})( |$)"
```

`os-check` is the OS layer's definition of done in one command: the validator, every test, `node --check` on every script, the graph summary. `docs-with-code` is skipped because the delivery is still uncommitted; it was already checked in this project, where the change was made. Running these is the whole point of the step. The upstream has a different root and a different `Project-OS`, so a check that passes here can fail there. Reading the files instead of running them does not count.

Then check parity: every OS-layer path must hold the same content in upstream as at this project's `HEAD`, apart from the permanent divergences below. Compare the blobs (`git ls-tree -r` on both sides, filtered by the manifest), not the file listing. Any other difference is drift the delivery introduced or failed to remove — find out which before committing.

Finally, search upstream's whole tree for what must never be published: this machine's paths, the project's own names, anything personal. A hit in a delivered file is fixed in this project and the patch rebuilt, not edited in upstream.

**Step 5 — commit in the upstream clone, and tag both sides.** The commit message describes what was delivered, what was carried by hand in Step 3, what was deliberately not delivered, and the result of the checks you actually ran. It names no hash of this project: those commits do not exist upstream. Tag the upstream commit `os-vN+1`, and tag this project's commit the patch was built from (`HEAD` at Step 1) `os-vN+1` too — it is the base of the next delivery.

**Do not push and do not open a PR.** Sending the branch or tags outward is the owner's decision. End by reporting the branch name, the commit, both tags, and the exact `git push` commands they would run.

## Permanent divergences

`CHANGELOG.md` records these. They are not drift and must not be "fixed" during a delivery:

- `Project-OS/Templates/Task.md` — upstream keeps the shorter template; the manifest excludes it with a `!` line.
- `Knowledge-OS/Rules/AI-Governance.md` — upstream keeps generic prose about the accepted branching Decision where this project links a specific ADR that exists only here. The patch will not apply cleanly to this file whenever this project changes it: keep upstream's sentence, take the rest.

If you find a third, do not decide it in passing. Record it in `CHANGELOG.md` under the divergences section and say so in the closing report.
