---
type: protocol
status: active
lifecycle: active
created: 2026-08-24
updated: 2026-10-25
---
# Knowledge Maintenance Protocol

Verify that knowledge still matches its own schema, its links and its evidence.

## 1. When

Run this protocol:

- after a significant body of work is completed;
- before starting a new Epic;
- when knowledge is suspected to be stale or inconsistent;
- after Knowledge OS itself is changed.

Do not run it opportunistically during an unrelated Task.

## 2. Schema Conformance

Verify that every entity:

- declares `type`, `lifecycle` and `status`;
- uses a `type` defined by [[Schema/Knowledge-Types]];
- uses a `lifecycle` defined by [[Schema/Knowledge-Lifecycle]];
- uses a `status` allowed for its entity type by [[Schema/Metadata-Schema]];
- is not an empty scaffold: a note whose body holds only headings is not knowledge, and must not be `active`.

Report violations. Do not invent a missing value.

### Stamping `updated`

Any change to a note's content sets its `updated` to today, in the same edit that makes the change. This is a step of every piece of work that touches knowledge, not a task for this protocol to catch up on later: by the time the protocol runs, the date the change actually happened is no longer recoverable.

- Content means statements: a changed claim, a new or removed section, a corrected fact, a revised relationship. Fixing a typo or reflowing a paragraph does not qualify — see [[Schema/Metadata-Schema]]'s Dates section.
- Set `created` in the same edit if it is absent. A note with `updated` but no `created` cannot be aged.
- Promotion and status changes count as content changes: they are claims about the note's standing.

Nothing enforces this yet, on purpose. `updated` was absent from most notes precisely because no step assigned it to anyone, and a staleness check added before the field is populated would pass over an empty set and read as working. Enforcement follows the field being filled, not the other way round.

`Tools/validate-vault.mjs` performs these checks deterministically. Run it rather than reading every entity by hand.

`Tools/validate-vault.test.mjs` fixes the validator's own behavior: one fixture vault per rule under `Tools/__fixtures__/`, each with exactly one violation. Run it — `node --test "Knowledge-OS/Tools/validate-vault.test.mjs"` — after changing the validator, before trusting its output. A rule change with no matching fixture update is unverified.

`Tools/stale-check.mjs` answers, for every note carrying `source`, whether the code it cites has changed since the commit it cites — `git log <commit>..HEAD -- <path>`. Run it when reviewing lifecycle (§4): a note whose evidence has moved is a candidate for re-checking, not for demotion. The validator reports the same condition as the `stale-source` warning; this tool names the commits, which is what tells you whether the change touched what the note actually claims.

`Tools/context-metrics.mjs --write` records what the work cost and how the knowledge base was traversed. Run it after a significant body of work; a rising share of re-read governance means those documents should be declared as required context rather than rediscovered each time.

## 3. Link Integrity

Verify that:

- no link points to a missing entity;
- no entity that should be reachable is orphaned;
- each relationship uses a type defined by [[Schema/Relationship-Types]];
- relationship direction is still correct.

Follow [[Rules/Linking-Rules]].

`Tools/validate-vault.mjs` answers whether each link is correct — it resolves, it is unambiguous, its `field::` is a declared type, and nothing is unreferenced. Those checks are local: each looks at one note.

`Tools/graph-report.mjs` answers the question they cannot. A vault can pass every local check and still be several disconnected islands, each internally tidy, with the reader who starts at the entry point never learning the others exist. The report gives the number of connected components (one is the healthy answer), how many notes are reachable by actually following links from an entry point, which relationship types are in use, and what share of edges declare a type rather than being bare prose links. It reports and never fails — the gate is the validator; this is a description.

A vault has more than one entry point, so a note unreachable from `Project-OS/00-Home` may be perfectly reachable from `Knowledge-OS/README`. Run it with `--from` before concluding anything.

## 4. Lifecycle Review

Confirm that each entity's `lifecycle` still reflects reality.

Promotion from `draft` to `active` requires all of:

1. the entity meets the evidence floor for its type in [[Schema/Evidence-Schema]];
2. no statement in the entity is still `inferred` or `unknown`;
3. no `open` uncertainty marked blocking refers to the entity;
4. the human owner has accepted it as current.

A blocking uncertainty is not a note for later. While it is open, the knowledge it affects stays `draft`.

Claude may propose this transition.

Claude may perform it for `Research` once its `status` is `completed`, and for `Log` and `Resource` entities.

Claude may perform it for a `Task` the moment its `status` reaches `done`, and for an `Epic` the moment its `status` reaches `active` or `done` — and must, in the same edit. This is not a judgement call held for a later pass: a Task that closes in `draft` reads as finished while carrying no `evidence`, and an Epic that stays `draft` keeps its whole subtree out of `blocking-uncertainty-on-active`, so the gate that stops work on open blocking questions is switched off by a field nobody updated. An Epic under way is the case that matters most here, because that is when its Tasks are being worked on; its `status` is derived from those Tasks rather than asserted, so the promotion records a fact the links already state. The closing ritual in `Project-OS/06-AI/AI.md` Part 2 is where it happens; `lifecycle-behind-status` in `Tools/validate-vault.mjs` is what notices when it did not.

Claude must not perform it for `Product`, `Architecture` or `Decision` entities without explicit acceptance. Follow [[Rules/AI-Governance]]. For a Decision the acceptance and the promotion are one act: an `accepted` Decision left `draft` is refused by the same `lifecycle-behind-status`, so the owner's acceptance is recorded by setting both fields together.

Move knowledge to `superseded` when a replacement exists, and to `archived` when it is retained only for history.

### Cadence

At each run of this protocol, re-check every `draft` entity of type `Product`, `Architecture`, `Decision` or `Research` whose `created` is more than 14 days old: has its evidence floor, its blocking uncertainties, or its body substance changed since the last check. No change means no action — re-checking is not re-writing. A change means proposing the transition above.

## 5. Duplication

Identify entities that represent the same knowledge.

Merge into the most specific existing entity and record `supersedes` on the replacement.

Follow [[Rules/Promotion-Rules]].

## 6. Knowledge OS Integrity

When Knowledge OS itself has changed, verify that:

- its own documents follow [[Schema/Metadata-Schema]];
- each Knowledge OS document uses a meta type from [[Schema/Knowledge-Types]];
- `Schema/schema.json` still lists any type, lifecycle, status, relationship, evidence level or floor introduced or renamed by the change.

`schema.json` is the single source of these values; the `.md` files under `Schema/` describe what they mean. A value used in a note but absent from `schema.json` fails validation, and a value present in `schema.json` but undocumented in its `.md` file misleads a reader without failing anything — check both directions by hand.

A change to the OS layer is not finished until it meets the three-part definition of done in `Docs/10-Extending.md` ("Готово, когда"): its documentation is current, its links are intact, its scripts run. `npm run os:check`, from the vault root, checks the last two and whether the documentation was touched at all; whether it was touched correctly stays with whoever made the change.

## 7. Report

Report findings as concrete violations with their entity paths.

Apply only fixes that are mechanical and unambiguous:

- a required field whose correct value is certain;
- a link whose target was renamed;
- a relationship type replaced by a defined one.

Escalate everything else.

Do not rewrite unrelated knowledge while reporting.

## Boundary

This protocol verifies existing knowledge.

It does not create project knowledge, expand scope, or reorganize the knowledge graph.

## Principle

Knowledge that no longer matches its schema, its links or its evidence is not yet knowledge.
