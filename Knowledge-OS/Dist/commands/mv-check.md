---
description: Run validate-vault.mjs and relay the result as-is
argument-hint: "[--json]"
allowed-tools: Read, Bash(node:*)
---

Resolve the vault root first (sibling `Knowledge-OS`/`Project-OS` folders; ask if not found).

Run, through the launcher, which picks a Node new enough for the tools even when the project's default is older:

```
node "<vault-root>/Knowledge-OS/Tools/mv.cjs" validate-vault $ARGUMENTS
```

Nothing needs installing first: the validator's one library is vendored. If the launcher exits with code 3, it found no Node 18 or newer — relay its message as printed; it names what it found and how to fix it.

Report PASS or FAIL and the exact error/warning list as printed.

Do not attempt to fix anything found in this same invocation. That's a separate step the human can ask for once they've seen what's wrong.
