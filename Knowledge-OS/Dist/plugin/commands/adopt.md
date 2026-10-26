---
description: Install MemoValeOS into this project — personal (plugin, no tracked file changes) or team (copies) — or take it out; you plan, the owner applies
argument-hint: "[--local|--team] [--uninstall] [--exclude-host-claude-md] [--only <classes>]"
allowed-tools: Glob, Read, Bash(node:*), Bash(git:*)
---

<!-- Built by Knowledge-OS/Tools/build-plugin.mjs from Knowledge-OS/Dist/commands/mv-adopt.md. Edit the source, then rebuild. -->

This command's text lives in this project's MemoValeOS vault, not in the plugin, so the two cannot disagree.

1. Find the vault: the project root `${CLAUDE_PROJECT_DIR}` itself, or one of its direct subfolders, whichever holds both `Knowledge-OS/` and `Project-OS/`. Try `${CLAUDE_PROJECT_DIR}/MemoValeOS/` first; otherwise Glob `*/Knowledge-OS/Dist/commands/mv-adopt.md` and `Knowledge-OS/Dist/commands/mv-adopt.md` from the project root. If there is no vault, say so and stop.
2. Read `<vault>/Knowledge-OS/Dist/commands/mv-adopt.md` and follow it exactly as the command `/mv:adopt`, with these arguments: $ARGUMENTS
   The text calls itself `/mv-adopt` and names its siblings `/mv-…`: in this plugin `/mv-x` is `/mv:x`.
