---
description: Close the session — run the Session Closing Ritual in Project-OS/06-AI/AI.md: Findings, Task and Epic close-out, Current Context refresh, metrics snapshot
allowed-tools: Glob, Read, Write, Edit, Grep, Bash(node:*), Bash(git:*), Bash(rm -f *budget.json)
---

<!-- Built by Knowledge-OS/Tools/build-plugin.mjs from Knowledge-OS/Dist/commands/mv-close.md. Edit the source, then rebuild. -->

This command's text lives in this project's MemoValeOS vault, not in the plugin, so the two cannot disagree.

1. Find the vault: the project root `${CLAUDE_PROJECT_DIR}` itself, or one of its direct subfolders, whichever holds both `Knowledge-OS/` and `Project-OS/`. Try `${CLAUDE_PROJECT_DIR}/MemoValeOS/` first; otherwise Glob `*/Knowledge-OS/Dist/commands/mv-close.md` and `Knowledge-OS/Dist/commands/mv-close.md` from the project root. If there is no vault, say so and stop.
2. Read `<vault>/Knowledge-OS/Dist/commands/mv-close.md` and follow it exactly as the command `/mv:close`, with these arguments: $ARGUMENTS
   The text calls itself `/mv-close` and names its siblings `/mv-…`: in this plugin `/mv-x` is `/mv:x`.
