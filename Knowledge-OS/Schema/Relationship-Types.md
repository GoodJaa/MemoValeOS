---
type: schema
status: active
lifecycle: active
---
# Relationship Types

Relationships define semantic connections between knowledge entities.

## Types

- `contains` — entity contains another entity.
- `depends-on` — entity requires another entity.
- `implements` — entity implements another entity.
- `constrained-by` — entity is constrained by another entity.
- `supports` — entity provides evidence or support for another entity.
- `affects` — entity changes or influences another entity.
- `based-on` — entity is derived from another entity.
- `supersedes` — entity replaces another entity.
- `related-to` — entities are meaningfully related without a stronger relation.

## Rules

- Use the most specific applicable relationship.
- Preserve relationship direction.
- Do not create new relationship types for individual cases.
- Do not use `related-to` when a more specific relationship applies.
- A relationship must represent a meaningful semantic connection.
- A relationship does not imply that the target must be loaded into context.


## Representation

Record a relationship as an inline field in the note body:

`relationship-type:: [[Target]]`

Examples:

- `depends-on:: [[Core-Engine]]`
- `constrained-by:: [[ADR-003 Plugin Isolation]]`
- `supersedes:: [[Old Parser Design]]`

Rules:

- The field name must be a relationship type defined above.
- Place the field in the section it belongs to, or under `## Related`.
- The relationship is directed: record it on the source entity, pointing to the target.
- Repeat the field to record several targets of the same type.
- A plain `[[link]]` carries no relationship type and asserts no relationship.

The link inside a relationship field still resolves as an ordinary wikilink — the graph, backlinks and the validator all see it regardless of tooling. Querying it *as a typed field* requires the **Dataview** community plugin.

Dataview is the only reader this layer has. Bases reads YAML frontmatter, and [[Metadata-Schema]] forbids recording relationships there, so nothing else can answer a question about relationship type. Without Dataview a relationship is still written down and still validated, but it cannot be asked about.

## Querying

Two shapes answer most relationship questions.

Forward — what an entity points at:

    TABLE WITHOUT ID file.link AS entity, depends-on
    FROM "Project-OS"
    WHERE depends-on

Reverse — what points at an entity:

    LIST FROM "Project-OS"
    WHERE contains(depends-on, link("Core Engine"))

Rules:

- Substitute any relationship type defined above for `depends-on`.
- A hyphen in a field name needs no escaping: `depends-on` works directly in both column and `WHERE` positions.
- A field repeated on one note reads as a list, so `length(contains)` counts its targets.
- A query returns what is recorded, not what is true. A relationship nobody wrote down is invisible to it.

## Boundary

This schema defines relationship types only.

Relationship usage is defined by [[Rules/Linking-Rules]].

Context selection is defined by [[Protocols/Context-Selection-Protocol]].

The exact relationship-type list enforced by the validator lives in `Schema/schema.json`. This page explains what each type means; `schema.json` is the source of the values themselves.