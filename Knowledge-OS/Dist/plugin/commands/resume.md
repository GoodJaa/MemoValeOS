---
description: Resume work — after a normal session gap, or after reconnecting from an Obsidian/MCP disconnection; with a key, on that Task
argument-hint: "[<task key>]"
allowed-tools: Read, Glob, Grep, Write(.claude/budget.json), Bash(node:*)
---

<!-- Built by Knowledge-OS/Tools/build-plugin.mjs from Knowledge-OS/Dist/commands/mv-resume.md. Edit the source, then rebuild. -->

This command's text lives in this project's MemoValeOS vault, not in the plugin, so the two cannot disagree.

1. Find the vault: the project root `${CLAUDE_PROJECT_DIR}` itself, or one of its direct subfolders, whichever holds both `Knowledge-OS/` and `Project-OS/`. Try `${CLAUDE_PROJECT_DIR}/MemoValeOS/` first; otherwise Glob `*/Knowledge-OS/Dist/commands/mv-resume.md` and `Knowledge-OS/Dist/commands/mv-resume.md` from the project root. If there is no vault, say so and stop.
2. Read `<vault>/Knowledge-OS/Dist/commands/mv-resume.md` and follow it exactly as the command `/mv:resume`, with these arguments: $ARGUMENTS
   The text calls itself `/mv-resume` and names its siblings `/mv-…`: in this plugin `/mv-x` is `/mv:x`.
