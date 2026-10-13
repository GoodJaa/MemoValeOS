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

An `active` note citing `src/thing.ts` as it stood at the seeded commit. The
test then commits a change to that file, so the cited evidence has moved on
without the note. That is `stale-source`: unverified, not wrong.
