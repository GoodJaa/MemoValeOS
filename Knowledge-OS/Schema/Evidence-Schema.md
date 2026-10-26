---
type: schema
status: active
lifecycle: active
---
# Evidence Schema

Evidence describes how a statement was established. It separates what the project knows from what it assumed.

## Claim Status

Every substantive statement in project knowledge has one of:

- `verified` — established from evidence that is cited.
- `user-provided` — stated by the human owner.
- `inferred` — derived by reasoning, not observed.
- `unknown` — not established.

Rules:

- A `verified` statement must cite its evidence.
- An `inferred` or `unknown` statement must not be written as a fact.
- Do not upgrade a status without new evidence.

## Evidence Levels

- `L1` — a file or code path was read.
- `L2` — an execution result was observed: a test, a log, a command output.
- `L3` — behavior was observed on the real surface the user reaches: a route, an interface, an API response.
- `L4` — confirmed with the human owner.

A higher level does not replace a lower one. It answers a different question: `L1` says the code says so, `L3` says the system does so.

## Floors

Minimum evidence required before knowledge is treated as current:

- `Research` — `L1` with a cited source.
- `Architecture` — `L2`.
- `Decision` — `L2` and explicit acceptance by the human owner; a rule inherited from the host, `user-provided` with its source and ratification date (below).
- `Product` — `user-provided` or `L4`.

`user-provided` is the one value of `evidence` that is not a level. The L1–L4 ladder grades how directly a claim was observed in the running system; `user-provided` says the claim is the owner's to make, and no amount of reading code can establish or refute it — what a product is *for* is not discoverable from its source. Ranking it against the levels would be a category error, so it is not in `evidenceLevels`; `evidenceAlternativeByType` in `schema.json` records it as satisfying the Product floor instead, and `validate-vault.mjs` accepts it there in place of `L4`.

`Resource` takes it on the same grounds: a note recording where knowledge came from, or what an external document was, rests on the owner's account of it — and in this vault the source documents were removed once imported, so no citation could be checked even in principle.

Use it only where that is literally true: a statement of intent, scope, audience or provenance made by the owner. A claim about what the code *does* is never `user-provided`, whoever said it — that is observable, and saying so does not make it true.

### A Decision inherited from the host

A project the OS is installed into often has rules already: a `CLAUDE.md`, a contributing guide, a convention everyone follows. Filed as Decisions, they could never become current: a team's rule — "deploy on Fridays", "no raw SQL in handlers" — is not something a test observes, so it cannot reach `L2`, and on the first real installation every one of them stayed `proposed`. Its authority is that the team adopted it.

So a Decision may stand on `user-provided` when it says where it came from (`origins.inherited` in `schema.json`; owner's decision, 2026-10-25):

- `origin: inherited` — the rule existed in the host before the OS did;
- `source` — the host file and the commit it was read at, as a list of `{path, commit}`. `stale-source` then watches it: when the team changes that file, the Decision is reported unverified until it is ratified again;
- `ratified` — the date the owner confirmed it as the project's rule. Required once the Decision is `active`.

`origin-incomplete` refuses an inherited Decision without them. The project's own Decisions keep the `L2` floor: `user-provided` reaches a Decision only through this origin, and an owner saying a choice was made does not show that it holds.

Rules:

- Passing tests are not evidence for a claim about a surface the tests do not exercise.
- A claim about observable behavior is not established at `L1` alone.
- Record the level actually reached, not the level intended.

### Task carries a floor of its own

A finished `Task` states that something was built and works, which is a claim about the running system like any other — so `evidenceFloorByType` gives it `L2`: whoever closed it ran the work and observed the result.

The floor alone does not reach the case it was added for. A floor applies to `lifecycle: active` notes, and a Task closed while still `draft` is never checked at all — `status: done` makes it read as finished while it carries no grade, no `created` and no `updated`. That is not hypothetical: T11 and T12 closed that way and were found only by comparing neighbouring tasks by hand. `lifecycle-behind-status` in `Tools/validate-vault.mjs` is the half that notices — for a Task `done`, an Epic `active` or `done`, and a Decision `accepted` (`activeLifecycleStatuses` in `Schema/schema.json`). A draft Epic keeps its whole subtree out of `blocking-uncertainty-on-active`, so a stale field there switches off a gate rather than merely looking untidy.

## Scope

This schema governs project knowledge: core types (`Product`, `Architecture`, `Epic`, `Task`, `Research`, `Decision`, `Idea`) and operational types (`Prompt`, `Log`, `Resource`, `Finding`).

Meta types (`readme`, `index`, `schema`, `rule`, `protocol`) describe the system itself, not a project fact. Their authority comes from being accepted by the human owner, not from cited evidence — `lifecycle: active` on a meta-type document requires no `evidence` field. `Tools/validate-vault.mjs` does not check meta types for it.

The exact evidence levels and floors enforced by the validator live in `Schema/schema.json`. This page explains what each level and floor means; `schema.json` is the source of the values themselves.

## Recording

Use the optional `evidence` metadata field defined by [[Metadata-Schema]] when an entity as a whole rests on one level.

When statements inside an entity rest on different levels, record the level next to the statement instead.

### Recording by action

Asking for a level directly costs a moment of recalling what `L1` through `L4` mean. Asking for the action taken does not — the action is what the author already remembers doing. A command that records evidence (`/mv-note`) may ask which of these was done and record the corresponding level, per `evidenceActionMap` in `Schema/schema.json`:

- `read` → `L1`
- `ran` → `L2`
- `used` → `L3`
- `confirmed` → `L4`

This is a recording shortcut, not a different schema — the level it produces means exactly what [[#Evidence Levels]] says it means.

## Boundary

This schema defines how strongly something is established.

[[Knowledge-Lifecycle]] defines whether knowledge is current.

[[Protocols/Knowledge-Maintenance-Protocol]] applies these floors when knowledge is promoted.

## Principle

An unverified statement is not knowledge yet. It is an uncertainty with better wording.
