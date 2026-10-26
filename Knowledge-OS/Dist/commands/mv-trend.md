---
description: Summarize the trend across recorded context-metrics sessions — cannot say whether this beats not using the system
allowed-tools: Read, Bash(node:*)
---

Resolve the vault root first (sibling `Knowledge-OS`/`Project-OS` folders; ask if not found).

Read `Metrics/Context-Metrics.md` in full. Do not run `context-metrics.mjs` — this command reads only the accumulated log table, whose columns are `Session | Ended | Requests | Output | Context peak | Mean | p95 | Notes | Files | Re-read | Coverage | Hit% | Breaks | Reproc | Label | Shell | Writes`.

If the table has fewer than about 3 data rows, say plainly that it's too early to see a trend — do not force a narrative out of noise.

Otherwise, report trends across the rows for exactly what those columns hold:
- **Re-read share** — falling means the assistant is settling into the vault's shape; flat or rising means it's relearning the same ground each session.
- **Context peak, mean and p95** — held against the system's own claim that cost shouldn't grow with the knowledge base: read them against the `Notes` column (the count of `.md` files under Project-OS/ at write time). Flat or sublinear growth as notes accumulate supports the claim; tracking the note count upward does not. Peak is one moment in a session — mean and p95 say whether the session sat there or only touched it.
- **Coverage** — shifting toward full-file reads or toward skimming.
- **Hit%, Breaks and Reproc** — prefix-cache behaviour. Rising breaks and reprocessed tokens mean something is invalidating the reusable prefix mid-session. Rows before 2026-09-14 predate these columns and are empty; do not read an empty cell as a zero.
- **Label** — rows are not all the same kind of work. Compare `task` rows with `task` rows; `control`, `maintenance` and `plan-review` rows are not part of the same series.
- **Shell** — governance and project files read through Bash or PowerShell, parsed from the command line. A heuristic, kept apart from Files and Re-read; a row with Files 0 and a non-zero Shell read its knowledge through the shell. Rows before 2026-10-13 have `—`.
- **Writes** — distinct Project-OS notes each session wrote, by kind (`T` task or epic, `F` finding, `R` research, `A` architecture, `D` decision, `P` product, `U` uncertainty ledger, `C` Current Context, `O` other); `0` is a measured nothing, `—` predates the column (os-v9). Among `task` rows, say how many wrote anything besides `T` and `C`. Sessions that write only Tasks and Context while `Notes` stays flat mean what the work finds is not becoming knowledge — the failure the closing ritual's inventory exists to catch. A count is not a judgment of a session: one that established nothing new rightly writes nothing.

**Do not compute the share of work on the operating system (C3) from the Label column.** Sessions that work on the OS often write no row, so the share of `maintenance` rows measures what was recorded, not what was done. Run `node "Knowledge-OS/Tools/mv.cjs" os-share` from the vault root instead — it reads git — and report its total and its last few weeks as they stand.

Note explicitly that the log does **not** record a governance:project traversal ratio per session — that figure exists only as a point-in-time read from `/mv-metrics --all`, not as a trend from this log. Mention it as available on request, not as something this command computed.

End every invocation with this fixed section, unconditionally:

> These numbers describe how this session used the knowledge base — they cannot say whether that's better or worse than not having it. That comparison needs a separate, deliberately unconfigured session (no vault, no MCP connection, no `CLAUDE.md` pointing at this system) given a comparable task, with `context-metrics.mjs` run against it for comparison. This command cannot simulate or approximate that arm. Consider running such a control session occasionally.

Do not soften or omit this section even if the trend looks favorable.
