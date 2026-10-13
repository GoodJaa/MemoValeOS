---
type: schema
status: active
lifecycle: active
---
# Knowledge Lifecycle

Lifecycle describes whether knowledge is current and usable.

## States

- `draft` — knowledge is being created or refined.
- `active` — knowledge is current and authoritative.
- `superseded` — knowledge has been replaced by newer knowledge.
- `archived` — knowledge is retained for history but is not current.

## Transitions

draft → active

active → superseded

active → archived

superseded → archived

## Rules

- New knowledge starts as `draft` unless its lifecycle is already established.
- Only `active` knowledge is treated as current project knowledge.
- `superseded` knowledge must not override its replacement.
- `archived` knowledge is not used by default.
- Lifecycle does not replace entity-specific `status`.
- A lifecycle change must not silently change the knowledge content.

- Promotion from `draft` to `active` follows [[Protocols/Knowledge-Maintenance-Protocol]].

## Using Draft Knowledge

`draft` knowledge may be read. It must not be relied on as established.

- Load it for orientation: it records what the project believes so far.
- Do not cite it as a project fact, and do not build a Decision on it.
- When work depends on a draft statement, verify that statement to the level its type requires in [[Evidence-Schema]], or record an uncertainty.
- Prefer repository evidence over a draft statement when the two disagree.

A newly initialized Project OS is entirely `draft`. That is the correct starting state: a skeleton is not knowledge, and an empty section is not a fact about the project.

## Boundary

Entity workflow state belongs to `status`.

Knowledge validity belongs to `lifecycle`.

The exact state list enforced by the validator lives in `Schema/schema.json`. This page explains what each state means; `schema.json` is the source of the values themselves.