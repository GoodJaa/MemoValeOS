---
description: Initialize a new project's knowledge — Project Initialization Protocol
allowed-tools: Read, Glob, Grep, Edit
---

Resolve the vault root first (sibling `Knowledge-OS`/`Project-OS` folders; ask if not found).

Read `Knowledge-OS/Protocols/Project-Initialization-Protocol.md` in full — do not follow it from memory, its exact wording governs what counts as compliant here. Then work through its sections in order:

1. **Establish Product** — ask the human directly for product identity, purpose, current scope, and initial constraints. Do not invent any of this. Record it with `evidence: user-provided`.
2. **Establish Architecture** — only if the system structure is already known to the human. If it is not, say so and point at `/mv-survey` instead of creating placeholder Architecture entities.
3. **Establish Development Context** — create an Epic or Task only where there is genuinely defined work; do not manufacture one to have something to show.
4. **Record Existing Knowledge** — Research/Decision/Idea entities only from what's actually verified; nothing speculative.
5. **Establish Relationships** — only relationships the available information actually supports.
6. **Verify** — run the protocol's own verification checklist literally, item by item, and report any unmet item rather than declaring success.
7. **Missing Information** — anything still unknown stays unknown or becomes an `Uncertainties.md` row; never filled in with a guess.

Do not build out the full knowledge graph up front — the protocol's own Boundary section is explicit that initialization is minimal, not exhaustive.
