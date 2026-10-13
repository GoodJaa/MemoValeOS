---
description: Deploy Knowledge OS + Project OS into the connected Obsidian vault, or verify an existing deployment
allowed-tools: Read, Glob, Bash
---

Resolve the vault root first: look for a directory containing sibling folders literally named `Knowledge-OS` and `Project-OS`. Check the current directory, then one level of subdirectories. If neither is found, ask the user for the vault path rather than guessing.

## If Knowledge OS and Project OS already exist

Deployment is already done. Skip straight to Verify below — do not attempt to re-run anything.

## If they do not exist

1. Look at the tools actually available in this session for anything whose name suggests an Obsidian MCP connection (containing `obsidian`, `execute_template`, or similar). Do not assume one exists just because it existed in a past session — check the current tool list.
   - If such a tool is present: tell the user it appears available, and ask for explicit confirmation before using it — it would write into the vault. Do not invoke it without that confirmation. After invoking it, still run Verify below; its actual effect is not guaranteed until checked.
   - If no such tool is present: say so plainly, and go straight to the manual path.
2. Manual path: read this vault's `README.md`, section "Установка" (or "Installation"), and relay its steps to the user verbatim from the file — do not paraphrase from memory, since the exact plugin names and click paths matter. The steps cover: clone the repository (the vault arrives as plain files — there is no generator to run), enable the MCP Connector community plugin and the core `bases`/`properties` plugins (Dataview if typed relationships should be queryable), run `npm install` at the repository root, and validate.
3. Wait for the user to confirm they've completed the manual steps (or for the MCP-driven attempt to finish) before continuing to Verify.

## Verify

Run:

```
node "<vault-root>/Knowledge-OS/Tools/validate-vault.mjs"
```

Report `OK` or the exact failure list — do not summarize errors away.

## Connect Claude Code to the vault (optional, only if not already connected)

Check whether an MCP server for this vault is already configured (e.g. an existing `obsidian` entry reachable in this session). If one already works, say so and stop here.

Otherwise, try to read `<vault-root>/.obsidian/plugins/mcp-tools-istefox/data.json` directly from disk (not via MCP, since if MCP already worked you wouldn't be here) for `mcpTransport.livePort` and `mcpTransport.bearerToken`. If the file doesn't exist yet, tell the user it will appear after Obsidian has been run once with the MCP Connector plugin enabled, and point them at the plugin's own settings tab instead of guessing values.

If both values are found, construct and show — but do not run without explicit confirmation — the exact command:

```
claude mcp add --transport http obsidian http://127.0.0.1:<port>/mcp --header "Authorization: Bearer <token>"
```

This mutates Claude Code's own configuration; never run it silently.
