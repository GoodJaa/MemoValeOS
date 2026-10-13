---
type: research
status: completed
lifecycle: active
evidence: L2
source:
  - path: src/thing.ts
    commit: __COMMIT__
---
# Parser Note

The same note over the same history, except the second commit touches a
different file. The cited evidence is untouched, so the rule must stay silent.
A staleness rule that fires when nothing moved is worse than none: it teaches
the reader that the warning means nothing.
