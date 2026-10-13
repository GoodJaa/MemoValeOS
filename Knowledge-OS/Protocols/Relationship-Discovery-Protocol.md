---
type: protocol
status: active
lifecycle: active
---
# Relationship Discovery Protocol

Discover and record meaningful semantic relationships during project work.

## 1. Identify

Identify relationships revealed by the current Task or implementation.

Consider:

- dependencies;
- implementation;
- constraints;
- effects;
- supporting evidence;
- derivation;
- replacement.

Do not scan the entire knowledge graph without a task-relevant reason.

## 2. Verify

Before creating a relationship:

1. verify both entities;
2. verify the relationship using available evidence;
3. determine its direction;
4. select the most specific type from [[Schema/Relationship-Types]].

If the relationship is uncertain, do not record it as established.

## 3. Create or Update

- create the relationship if it does not exist;
- update it if its meaning has changed;
- remove it if it is no longer valid;
- do not create duplicates.

Follow [[Rules/Linking-Rules]].


Record each relationship using the inline field syntax defined by [[Schema/Relationship-Types]].

## 4. Context

Do not load a linked entity automatically.

Use [[Protocols/Context-Selection-Protocol]] to determine whether it is required for the current Task.

## 5. Scope

Discover only relationships relevant to the current work.

Do not attempt to complete the entire project graph.

## 6. Completion

Verify that:

- relationship type is valid;
- direction is correct;
- both entities are valid;
- no duplicate relationship was created.

Return to the current Task.