---
type: protocol
status: active
lifecycle: active
---
# Project Initialization Protocol

Initialize Project OS with the minimum knowledge required to begin work.

## 1. Establish Product

Create or verify the primary `Product` entity.

Record only:

- product identity;
- purpose;
- current scope;
- initial constraints.

## 2. Establish Architecture

Create the initial `Architecture` entity only when the system structure is known.

On a repository that already exists, that structure is not known yet. Establish it with [[Repository-Survey-Protocol]] before continuing, and treat what it produces as `draft` at `L1`.

Record:

- major system boundaries;
- core components;
- known dependencies;
- unresolved architectural areas.

Do not invent architecture to fill missing information.

## 3. Establish Development Context

Create the initial `Epic` or `Task` only when there is defined work to perform.

A Task must have a clear scope and expected result.

## 4. Record Existing Knowledge

During initialization, capture only verified project-specific knowledge.

Use:

- `Research` for findings;
- `Decision` for explicitly accepted choices;
- `Idea` for future possibilities.

Follow [[Schema/Knowledge-Types]].

## 5. Establish Relationships

Add only relationships supported by the available information.

Use [[Schema/Relationship-Types]] and [[Rules/Linking-Rules]].

Do not build the complete knowledge graph during initialization.

## 6. Verify

Before starting development, verify that:

- Product intent is defined;
- current scope is clear;
- known architectural constraints are recorded;
- current work has a defined Task or Epic;
- important existing Decisions are recorded;
- no critical assumptions were presented as facts.

## 7. Missing Information

If required project information is unknown:

- leave it unknown;
- record the uncertainty when useful, in `Project-OS/04-Research/Uncertainties.md` — create it from [[Project-OS/Templates/Uncertainty-Ledger]] if the project has none yet, since Repository-Survey and later work write to it as an existing ledger;
- do not invent a value;
- continue only when the missing information does not block the current work.

## Boundary

Initialization establishes the minimum viable project knowledge.

It does not require:

- documenting the entire repository;
- creating the complete architecture;
- creating future roadmap entities;
- importing generic technical knowledge;
- building all relationships;
- filling every Project OS file.

Expand Project OS only as real project knowledge is discovered.

