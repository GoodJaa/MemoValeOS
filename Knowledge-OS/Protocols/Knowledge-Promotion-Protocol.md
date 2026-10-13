---
type: protocol
status: active
lifecycle: active
---
# Knowledge Promotion Protocol

Promote durable project knowledge discovered during work into the appropriate knowledge entity.

## 1. Detect

After completing meaningful work, inspect the result for information that may have lasting project value.

Check whether the information:

- affects future implementation;
- changes an architectural constraint;
- resolves a significant uncertainty;
- provides reusable project-specific knowledge;
- represents an accepted decision.

Use [[Rules/Promotion-Rules]].

## 2. Classify

Select the smallest appropriate knowledge type:

- technical finding → `Research`
- accepted choice → `Decision`
- persistent system structure → `Architecture`
- future capability → `Idea`
- other project knowledge → appropriate existing type

Use [[Schema/Knowledge-Types]].

## 3. Check Existing Knowledge

Before creating an entity:

1. search for an existing representation;
2. update it if it represents the same knowledge;
3. create a new entity only when the knowledge is distinct.

Avoid duplicates.

## 4. Record

When promotion is justified:

- create or update the target entity;
- preserve required metadata;
- add relevant semantic relationships;
- record only verified information;
- keep the entity within its defined scope.

Use [[Schema/Metadata-Schema]] and [[Rules/Linking-Rules]].

## 5. Lifecycle

New knowledge follows [[Schema/Knowledge-Lifecycle]].

Do not mark knowledge as `active` merely because it was discovered.

Promoted knowledge must meet the evidence floor for its type in [[Schema/Evidence-Schema]]. Record the level actually reached.

Knowledge affected by an `open` uncertainty marked blocking stays `draft` until that uncertainty is resolved or explicitly accepted as a risk.

Accepted project knowledge must be distinguishable from drafts, superseded knowledge, and historical records.

## 6. Decision Boundary

A discovered fact is not automatically a Decision.

If promotion would introduce or change an architectural choice:

1. record the finding;
2. identify the required decision;
3. obtain the required acceptance;
4. then record the Decision.

Follow [[Rules/AI-Governance]].

## 7. Scope

Promote only knowledge affected or discovered by the current work.

Do not reorganize unrelated knowledge during promotion.

## 8. Completion

After promotion:

- verify the resulting entity;
- verify its relationships;
- ensure no duplicate knowledge was created;
- return to the current Task.

Do not expand the knowledge graph beyond what the promotion requires.