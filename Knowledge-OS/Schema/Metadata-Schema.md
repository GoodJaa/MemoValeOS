---
type: schema
status: active
lifecycle: active
created: 2026-08-24
updated: 2026-10-26
---
# Metadata Schema

Metadata provides machine-readable identity, lifecycle, state and ordering for knowledge entities.

## Required

- `type` — entity type defined by [[Knowledge-Types]].
- `lifecycle` — knowledge lifecycle defined by [[Knowledge-Lifecycle]].
- `status` — current workflow state of the entity, for every type that has one (see Status below). Product and Architecture have none and must not carry the field.

## Optional

- `priority` — `high`, `medium`, or `low`.
- `evidence` — evidence level defined by [[Evidence-Schema]].
- `created` — creation date in `YYYY-MM-DD` format.
- `updated` — date of last meaningful modification in `YYYY-MM-DD` format.
- `stale` — `true` or `false`. Marks knowledge suspected to no longer match the repository it cites. **Superseded for notes carrying `source`, and not worth setting by hand.** It was specified as hand-maintained and was never once set in the first thirteen Tasks, which is what a field only a human can maintain amounts to. Staleness is now computed: see `source` below.
- `source` — list of `{path, commit}` pairs identifying the repository evidence a statement rests on, as of the commit where that evidence was established. Optional; use when a statement should be checkable against a specific code state rather than "the repository" in general.

  This is what makes staleness answerable rather than asserted: `git log <commit>..HEAD -- <path>` says whether the cited evidence has moved. `validate-vault.mjs`'s `stale-source` rule reports it as a **warning** on `active` notes, and `Tools/stale-check.mjs` asks the same question in detail, naming the commits. Stale evidence does not make a note wrong — it makes it unverified, which is why neither fails the build. A draft is not checked: it states nothing the vault is standing behind yet.
- `origin` — where the knowledge came from, when that changes what it needs. Values and what each requires live in `origins` in `Schema/schema.json`:
  - `inherited`, for a Decision that was the host project's rule before the OS was installed: it may stand on `evidence: user-provided`, and in return requires `source` and, once active, `ratified` ([[Evidence-Schema]], "A Decision inherited from the host");
  - `imported`, for a Task or Epic brought in from an external tracker by `Tools/task-import.mjs`: it requires `key`, and grants no evidence — an imported Task is `draft` until its work is done.

  An unknown value, or one on a type it is not defined for, is refused (`invalid-metadata-value`); missing fields are `origin-incomplete`.
- `key` — the item's key in an external tracker (`PRJ-101`), a string; quote one that is all digits. It is how an import finds the Task again and how `/mv-resume <key>` finds it at all. When `mvos.config.json` sets `tasks.keyPattern`, a key that does not match it is refused (`invalid-metadata-value`).
- `ratified` — `YYYY-MM-DD`, the date the owner confirmed an inherited rule as the project's. Set it again when `stale-source` reports the host's file moved and the owner has re-read the rule.

## Lifecycle

`lifecycle` must use a value defined by [[Knowledge-Lifecycle]].

Lifecycle describes whether the knowledge itself is current.

It is independent from entity-specific `status`.

## Status

`status` is defined by the entity type.

Values, enforced by `Tools/validate-vault.mjs` from `Schema/schema.json`:

- Task → `todo`, `in-progress`, `blocked`, `review`, `done`, `cancelled`
- Epic → `planned`, `active`, `blocked`, `done`, `cancelled`
- Research → `open`, `completed`, `obsolete`
- Decision → `proposed`, `accepted`, `superseded`, `rejected`
- Idea → `inbox`, `research`, `planned`, `implemented`, `rejected`, `archived`
- Log → `active`
- Index → `active`
- Finding → `active`
- Prompt → `active`
- Resource → `active`
- Readme, Schema, Rule, Protocol (meta types) → `active`
- Product, Architecture → **no `status`** (`status-not-allowed-for-type`)

This list is descriptive; `schema.json` is the source of the values themselves.

For `Log`, `Index`, `Finding`, `Prompt`, `Resource` and every meta type, `status` has exactly one allowed value (`active`) — these types carry no workflow of their own, and any transition they do have (superseded, archived) belongs to `lifecycle`, not `status`. The field stays required for them anyway: it costs one line and keeps every note filterable by status.

Product and Architecture are different: their dictionary was `draft`, `active`, `superseded` — the lifecycle vocabulary again. Two fields encoding one fact disagreed (six Architecture notes said `active` in one and `draft` in the other), so for these types `lifecycle` is the only field and `status` is refused.

**A settled status requires a settled lifecycle.** `activeLifecycleStatuses` in `schema.json` names, per type, the statuses after which the knowledge is relied on — a Task `done`, an Epic `active` or `done`, a Decision `accepted`. A note in one of them with `lifecycle: draft` is refused (`lifecycle-behind-status`). A type joins the rule by a line in that map.

Do not use entity-specific workflow states as lifecycle states.

## Priority

Optional. Use only when work ordering is meaningful.

Allowed values:

- `high`
- `medium`
- `low`

## Evidence

Required when `lifecycle` is `active`, for every type except the meta types (`readme`, `index`, `schema`, `rule`, `protocol`) — see [[Evidence-Schema]] Scope. Optional otherwise, when the entity as a whole rests on a single evidence level.

`evidence` must use a level defined by [[Evidence-Schema]].

Do not use it to claim a level that was not actually reached.

## Dates

Use ISO date format:

YYYY-MM-DD

- `created` — entity creation date.
- `updated` — last meaningful modification in the entity.

Do not update `updated` for insignificant formatting changes.

Whoever changes a note's content sets `updated` to today in that same edit — the rule is stated once, as a required step, in [[Protocols/Knowledge-Maintenance-Protocol]]'s Schema Conformance section. Meaningful means a changed claim, a new or removed section, a corrected fact, a revised relationship, or a change of `lifecycle`/`status`; a typo fix or reflowed paragraph is not. Set `created` in the same edit if it is missing: `updated` without `created` gives no age.

Neither field is enforced by `Tools/validate-vault.mjs` today. `updated` is deliberately unchecked until it is actually being filled — a staleness rule written against a mostly-absent field would pass trivially and look like a working check.

## Rules

- Keep metadata minimal.
- Do not store knowledge content in metadata.
- Do not record semantic relationships in frontmatter; represent them in the note body as defined by [[Relationship-Types]].
- Do not add fields for one-off cases.
- Add a field only when required for routing, lifecycle, filtering or automation.
- Use only values defined by the relevant schema or entity type.
- Use only the keys listed above. `Tools/validate-vault.mjs` rejects any other frontmatter key (`unknown-metadata-key`), enforced from `metadataKeys` in `Schema/schema.json` — a field not needed by more than one note does not belong in frontmatter; put it in the body instead.

## Boundary

Entity-specific content belongs to the entity type, not to this schema.

Semantic relationships are defined by [[Relationship-Types]] and represented through typed inline fields in the note body.

Lifecycle states are defined by [[Knowledge-Lifecycle]].

Evidence levels are defined by [[Evidence-Schema]].

The exact values for `priority` and every schema vocabulary referenced above live in `Schema/schema.json`.