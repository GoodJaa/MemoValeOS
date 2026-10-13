---
description: Map an existing codebase — Repository Survey Protocol
argument-hint: "[entry-points|budgeted]"
arguments: [mode]
allowed-tools: Read, Glob, Grep, Edit
---

Resolve the vault root first (sibling `Knowledge-OS`/`Project-OS` folders; ask if not found).

Read `Knowledge-OS/Protocols/Repository-Survey-Protocol.md` in full.

Determine the effective mode:
- If `$mode` is empty, read the current value from `Project-OS/06-AI/AI.md`'s "Survey Mode" section.
- If `$mode` is given, it must be exactly `entry-points` or `budgeted`. Anything else is an invalid argument — say so and stop; do not guess at what was meant.
- This override applies to this run only. Do not write it back into `AI.md` unless separately asked to.

Follow the protocol's matching section exactly:
- **entry-points** — survey outward from the system's edges: manifests → entry points → module boundaries → external edges → configuration. Never descend into implementation. Never follow a call chain past a module boundary.
- **budgeted** — before reading anything, present the reading plan (which files/directories, why) and wait for the human's approval before proceeding.

Output, following the protocol's granularity rules:
- One `Architecture` entity per independently-replaceable boundary — never per file or class. If an entity can't state its responsibility in one sentence, it covers too much.
- Each entity at `lifecycle: draft`, `evidence: L1`.
- Every open question raised becomes an `Uncertainties.md` row.
- Never create a `Decision` entity from this — a survey finds what the code does, not what anyone chose.
