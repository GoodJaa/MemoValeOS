---
type: log
status: active
lifecycle: active
evidence: L2
---
# Context Metrics

Measured by `Knowledge-OS/Tools/context-metrics.mjs --write`. Each row is one session.

Repeat share and coverage cover governance and project knowledge only; work on the operating system itself is excluded.
Notes is the count of `.md` files under Project-OS/ at write time, not at session time.

Hit% is the share of context served from the prefix cache. Breaks counts requests whose reusable prefix got
shorter than the previous request's, and Reproc is what that cost in tokens processed a second time.
Rows written before 2026-09-14 predate these three columns and leave them empty rather than claim a measurement.

Shell is the count of distinct governance and project files read through Bash or PowerShell (`cat`, `sed`,
`Get-Content`…), parsed from the command line. It is a heuristic and is kept apart from Files and Re-read,
which come from file tools only. Rows written before 2026-10-13 predate it.

| Session | Ended | Requests | Output | Context peak | Mean | p95 | Notes | Files | Re-read | Coverage | Hit% | Breaks | Reproc | Label | Shell |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
