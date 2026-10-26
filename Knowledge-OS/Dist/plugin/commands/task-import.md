---
description: Import a task, or an epic with its tasks, from a tracker this session reaches through MCP — a snapshot into Project-OS, planned before anything is written
argument-hint: "<resource> <ref> [--include-closed]"
allowed-tools: Read, Glob, Grep, Write, Bash(node:*)
---

<!-- Built by Knowledge-OS/Tools/build-plugin.mjs from Knowledge-OS/Dist/commands/mv-task-import.md. Edit the source, then rebuild. -->

This command's text lives in this project's MemoValeOS vault, not in the plugin, so the two cannot disagree.

1. Find the vault: the project root `${CLAUDE_PROJECT_DIR}` itself, or one of its direct subfolders, whichever holds both `Knowledge-OS/` and `Project-OS/`. Try `${CLAUDE_PROJECT_DIR}/MemoValeOS/` first; otherwise Glob `*/Knowledge-OS/Dist/commands/mv-task-import.md` and `Knowledge-OS/Dist/commands/mv-task-import.md` from the project root. If there is no vault, say so and stop.
2. Read `<vault>/Knowledge-OS/Dist/commands/mv-task-import.md` and follow it exactly as the command `/mv:task-import`, with these arguments: $ARGUMENTS
   The text calls itself `/mv-task-import` and names its siblings `/mv-…`: in this plugin `/mv-x` is `/mv:x`.
