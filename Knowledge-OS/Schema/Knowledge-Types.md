---
type: schema
status: active
lifecycle: active
---
# Knowledge Types

Knowledge OS uses a minimal set of entity types.

## Core Types

- `Product` — product definition and scope.
- `Architecture` — persistent system structure.
- `Epic` — coherent development outcome.
- `Task` — actionable unit of work.
- `Research` — technical or product finding.
- `Decision` — explicitly accepted choice or constraint.
- `Idea` — potential future capability or direction.

## Operational Types

- `Prompt` — reusable instruction for AI-assisted work.
- `Log` — temporary or historical work record.
- `Resource` — external reference used as supporting material.
- `Finding` — a single cheap, dated observation. One line of body, no further structure. Written at capture time with `lifecycle: active` — it does not sit in `draft` waiting on promotion, because nothing in this type ever matures; unlike every other template, `Finding`'s template does not set `evidence`, so an insertion outside `/mv-note` correctly fails `missing-evidence-for-active` rather than silently defaulting to a level nobody reached. A `Finding` is raw capture, not a conclusion; [[Rules/Promotion-Rules]] governs whether it ever becomes Research, a Decision, or an Architecture change.

Cheap to write is not the same as free to leave lying. A `Finding` carries one inline relationship naming what it is about — `affects::` or `related-to::`, per [[Relationship-Types]] — and a line in the area's Findings index. Without both it is reachable only by someone who already knows it exists, which is the one reader who does not need it; `orphaned-note` in `Tools/validate-vault.mjs` reports that condition. An observation with no subject anywhere in the vault is usually about the operating system rather than the project, and belongs in `Backlog.md` at the vault root.


## Meta Types

Some documents describe the system rather than the project. They use a separate set of types.

- `readme` — system entry point.
- `index` — routing or navigation document.
- `schema` — definition of entity structure, metadata, relationships, lifecycle or evidence.
- `rule` — behavioral constraint.
- `protocol` — step-by-step procedure.

Rules:

- Use a meta type for Knowledge OS documents.
- Use `index` for a navigation note in Project OS. A note that only routes to other notes holds no project knowledge of its own.
- Do not use any other meta type outside Knowledge OS.
- Do not use a core or operational type for a Knowledge OS document.

## Rules

- Use the smallest type that accurately represents the knowledge.
- Do not create new types for isolated cases.
- Do not use `Research` for accepted decisions.
- Do not use `Idea` for current requirements.
- Do not use `Log` as permanent project knowledge.
- Do not use `Resource` as project knowledge.
- Use `Finding` for a cheap capture, not for anything that already justifies Research, Decision or Architecture — write those directly instead of routing through a `Finding` first.

Entity fields and status are defined by [[Metadata-Schema]].
Lifecycle is defined by [[Knowledge-Lifecycle]].

The exact type list enforced by the validator lives in `schema.json`, in this same folder. This page explains what each type means; `schema.json` is the source of the values themselves.
