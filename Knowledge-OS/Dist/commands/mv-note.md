---
description: Record a Finding — cheap, dated capture of what
argument-hint: "<what>"
allowed-tools: Write, Read, Bash(node:*), Bash(git rev-parse:*)
---

Resolve the vault root first (sibling `Knowledge-OS`/`Project-OS` folders; ask if not found).

Treat `$ARGUMENTS` as `<what>` — the finding, in one line. If it carries an obvious circumstance (e.g. "in staging", "on cold start", "in the client call"), keep that folded into the same line rather than splitting it into a separate field; it is content, not metadata.

Ask two short questions before writing, both answerable in one token:

1. **Evidence** — which of these was done: `read` / `ran` / `used` / `confirmed`? Map to `evidence` via `evidenceActionMap` in `Schema/schema.json` (`read`→`L1`, `ran`→`L2`, `used`→`L3`, `confirmed`→`L4`). Do not ask for the level directly, and do not guess it — an unanswered question means the field stays absent, not defaulted.
2. **Scope** (optional, skip if it doesn't obviously apply) — does this belong to a defined project area? Only ask if `Schema/schema.json` already defines a `scope` vocabulary; if it does not yet, skip this question entirely rather than inventing values.

If the finding names a specific file or path in the repository, capture it as `source: [{path: <path>, commit: <commit>}]` — get `commit` from `git rev-parse HEAD` (or `--short`) at the vault root; if that fails (not a git repo, no commits), omit `source` rather than guessing. `HEAD` must already contain the change the finding is about: if that change is still uncommitted, `HEAD` is its parent, the cited path has moved since, and the note is born flagged `stale-source`. In that case commit first, or omit `source` and say which commit to stamp once it exists. Do not invent a path when the finding has none — most findings won't.

Create one file under `Project-OS/03-Development/Findings/`, named after `what` (short, filesystem-safe — this filename is the only human-readable label `.base` table views will show, since Bases reads frontmatter only). Shape, matching [[Project-OS/Templates/Finding]]:

```
---
type: finding
status: active
lifecycle: active
source: [{path: <path>, commit: <commit>}]   # only if a path applies
evidence: <L1-L4>                             # from the action question above
created: <YYYY-MM-DD>
updated: <YYYY-MM-DD>
---

<what>

affects:: [[<the Task, Epic, Architecture note or Decision this is about>]]
```

The relationship line is part of the shape, not an optional extra: a Finding nobody links to is reachable only by someone who already knows it exists, and `validate-vault.mjs` reports it as `orphaned-note`. Use `affects::` when the observation bears on that entity, `related-to::` when the connection is real but weaker — vocabulary from [[Knowledge-OS/Schema/Relationship-Types]]. If nothing in the vault is the subject, the observation is probably about the operating system itself: put it in `Backlog.md` at the vault root (create it if the vault has none yet) rather than forcing a link.

Do not expand this into a longer note, do not add sections, do not promote it to Research/Decision/Architecture in this same invocation — that judgment belongs to the review step in [[Knowledge-OS/Rules/Promotion-Rules]]'s Finding section, not to the act of capture. Writing the file is the entire job of this command.

Confirm with the file path and nothing else.
