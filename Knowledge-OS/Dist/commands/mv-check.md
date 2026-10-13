---
description: Run validate-vault.mjs and relay the result as-is
argument-hint: "[--json]"
allowed-tools: Read, Bash(node:*), Bash(npm install)
---

Resolve the vault root first (sibling `Knowledge-OS`/`Project-OS` folders; ask if not found).

If `<vault-root>/node_modules` does not exist, run `npm install` in `<vault-root>` first (the validator depends on `js-yaml`).

Run:

```
node "<vault-root>/Knowledge-OS/Tools/validate-vault.mjs" $ARGUMENTS
```

Report PASS or FAIL and the exact error/warning list as printed.

Do not attempt to fix anything found in this same invocation. That's a separate step the human can ask for once they've seen what's wrong.
