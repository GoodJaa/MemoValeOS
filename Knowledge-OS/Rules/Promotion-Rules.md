---
type: rule
status: active
lifecycle: active
---
# Promotion Rules

Promote information only when it has lasting value for the project.

## Promote

Promote a discovery when it:

- affects future implementation;
- is reusable beyond the current Task;
- changes or constrains architecture;
- resolves an important project uncertainty;
- records a significant project-specific finding.

## Target

Use the smallest appropriate knowledge type.

- implementation outcome → update the current Task when temporary;
- reusable technical finding → Research;
- accepted choice → Decision;
- persistent system structure → Architecture;
- future capability → Idea;
- something worth capturing right now, not yet worth writing up → `Finding`.

A Task result is not a separate knowledge type.

Follow [[Schema/Knowledge-Types]] and [[Schema/Knowledge-Lifecycle]].

## Finding

`Finding` exists to make capture cheaper than not capturing. Writing one requires no promotion decision — one line saying what was observed, an evidence level for how, the date, and an `affects::` link to where; done.

A `Finding` is not itself the destination. Review accumulated Findings periodically (see the session-closing ritual in [[Project-OS/06-AI/AI]]):

- several Findings pointing at the same thing → promote to Research, Decision, or Architecture per the Target rules above, using the normal evidence floor for that type;
- a Finding that never gets a second one → leave it; it cost one line to write and costs nothing to leave unpromoted.

Do not let `Finding` become a second inbox that only grows. If it accumulates without review, the ritual meant to empty it is not happening — that is itself worth a `Finding`.

## Do Not Promote

Do not promote:

- temporary implementation details;
- routine debugging information;
- generic programming knowledge;
- information already represented elsewhere;
- observations with no future impact;
- speculative ideas as project facts.

## Existing Knowledge

Before creating new knowledge:

1. search for an existing entity;
2. update it if it represents the same knowledge;
3. create a new entity only when the knowledge is genuinely distinct.

Avoid duplicate knowledge.

## Scope

Promote only information discovered or changed by the current work.

Do not rewrite unrelated knowledge.

## Decision Boundary

Do not turn a finding into an architectural Decision automatically.

If the finding requires a new architectural choice, record the finding first and create a Decision only when the choice is explicitly accepted.
