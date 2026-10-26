---
description: Deliver the OS layer from this project to the upstream MemoValeOS repository as a patch, without sharing this project's history
allowed-tools: Glob, Read, Bash(git:*), Bash(node:*), Bash(npm:*), Bash(ls:*), Bash(diff:*)
---

<!-- Built by Knowledge-OS/Tools/build-plugin.mjs from Knowledge-OS/Dist/commands/mv-sync.md. Edit the source, then rebuild. -->

This command's text lives in this project's MemoValeOS vault, not in the plugin, so the two cannot disagree.

1. Find the vault: the project root `${CLAUDE_PROJECT_DIR}` itself, or one of its direct subfolders, whichever holds both `Knowledge-OS/` and `Project-OS/`. Try `${CLAUDE_PROJECT_DIR}/MemoValeOS/` first; otherwise Glob `*/Knowledge-OS/Dist/commands/mv-sync.md` and `Knowledge-OS/Dist/commands/mv-sync.md` from the project root. If there is no vault, say so and stop.
2. Read `<vault>/Knowledge-OS/Dist/commands/mv-sync.md` and follow it exactly as the command `/mv:sync`, with these arguments: $ARGUMENTS
   The text calls itself `/mv-sync` and names its siblings `/mv-…`: in this plugin `/mv-x` is `/mv:x`.
