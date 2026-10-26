---
type: resource
status: active
lifecycle: draft
created: {{date}}
updated: {{date}}
---

# Environment

<!--
How to run things in this project, so that no session has to find out again.
The first real installation rediscovered Node, tokens and the database in most
sessions, until someone wrote this down by hand nine days in.

Lives at Project-OS/06-AI/Context/Environment.md, routed from AI-Context-Index.

Every row says when it was last checked and by which command. To use a row,
run its command; when it fails, or what it describes has changed, fix the row
in the same session and set its date — do not work around it. A row you only
read (a script in package.json) is L1; a row whose command you ran is L2.

Never write a secret here: name where a token or password lives, not its value.
-->

## Runtime

| What | Value | Checked | Command |
|---|---|---|---|
| Node for the project | | | `node -v` |
| Node for the OS tools | | | `node "<vault>/Knowledge-OS/Tools/mv.cjs" doctor` |
| Package manager | | | |

## Commands

| Purpose | Command | Checked | What a pass looks like |
|---|---|---|---|
| Install | | | |
| Test | | | |
| Lint | | | |
| Build | | | |
| Run | | | |

## Services and Access

| Service | How it is reached | Where the credential lives | Checked |
|---|---|---|---|

## Related
