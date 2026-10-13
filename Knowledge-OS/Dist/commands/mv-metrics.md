---
description: Run context-metrics.mjs against local session transcripts and report as-is
argument-hint: "[--session <id>] [--all] [--json] [--write] [--transcripts <dir>]"
allowed-tools: Read, Bash(node:*)
---

Resolve the vault root first (sibling `Knowledge-OS`/`Project-OS` folders; ask if not found).

Run:

```
node "<vault-root>/Knowledge-OS/Tools/context-metrics.mjs" $ARGUMENTS
```

Print the script's output as-is. Do not reinterpret it, do not add flags of your own, do not summarize it into a verdict — that's `/mv-trend`'s job, not this command's.
