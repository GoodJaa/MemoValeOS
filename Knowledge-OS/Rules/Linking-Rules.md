---
type: rule
lifecycle: active
status: active
---
# Linking Rules

Use semantic links to represent meaningful project relationships.

## Core

- Links represent relationships, not automatic context requirements.
- Use only relationship types defined by [[Schema/Relationship-Types]].
- Record each relationship using the inline field syntax defined by [[Schema/Relationship-Types]].
- Prefer the most specific applicable relationship.
- Preserve relationship direction.
- Do not create links without a meaningful relationship.
- Do not follow links recursively without a task-relevant reason.

## Context

A relationship does not imply that the target entity must be loaded.

Context selection is governed by [[Context-Rules]] and [[Protocols/Context-Selection-Protocol]].

## Linking

- Prefer existing relationships over duplicate relationships.
- Remove relationships that are no longer valid.
- Do not create new relationship types for individual cases.
- Use `related-to` only when no more specific relationship applies.
- When more than one file shares a name — a vault-root `README.md` and `Knowledge-OS/README.md`, an entity and its own empty template — link to it by full path. A bare link to a shared name resolves to whichever file the app picks, not necessarily the one meant. `Tools/validate-vault.mjs` reports this as `ambiguous-basename-link`.

## Boundary

This file defines how semantic links are interpreted and used.

[[Schema/Relationship-Types]] defines available relationship types.

[[Protocols/Relationship-Discovery-Protocol]] defines the procedure for discovering relationships.