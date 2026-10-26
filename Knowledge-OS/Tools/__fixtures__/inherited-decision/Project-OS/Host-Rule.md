---
type: decision
status: accepted
lifecycle: active
evidence: user-provided
origin: inherited
source:
  - path: CLAUDE.md
    commit: __COMMIT__
ratified: 2026-10-26
---
# Deploy on Fridays, never Thursdays

A rule the host team followed before the OS was installed, read from the
host's CLAUDE.md at the cited commit. Its authority is that the team adopted
it, which no test can observe, so the owner's ratification stands in for L2.
`stale-source` watches the cited file: when the team changes its CLAUDE.md,
this Decision is reported as unverified until someone ratifies it again.
