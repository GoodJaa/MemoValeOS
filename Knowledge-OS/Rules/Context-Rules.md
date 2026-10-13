---
type: rule
status: active
lifecycle: active
---
# Context Rules

Context must be task-relevant, minimal and sufficient.

## Relevance

Load knowledge when it:

- directly affects the current Task;
- defines a constraint for the Task;
- explains an implementation dependency;
- resolves an assumption or uncertainty;
- is required to interpret another loaded entity.

Do not load knowledge only because it is related.

## Context Classes

Classify candidate context as:

- `required` — needed for correct work;
- `conditional` — needed only when the current Task satisfies its condition;
- `supporting` — useful but not necessary.

Rules:

- load `required` context;
- load `conditional` context only when its condition applies;
- load `supporting` context only when required context is insufficient;
- never load context only because it is linked.

Do not encode these classes as metadata unless a future automation requirement makes this necessary.