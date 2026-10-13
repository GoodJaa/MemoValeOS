---
type: protocol
status: active
lifecycle: active
created: 2026-09-12
updated: 2026-10-01
---
# Context Provider Protocol

This protocol exposes MemoValeOS as an optional, read-and-propose context provider for any external
tool — an orchestrator, an agent runtime, a CI job — that needs durable project knowledge. The
caller owns its own task and its own outcome; MemoValeOS supplies selected project knowledge and
receives knowledge proposals. Neither side becomes a hidden source of truth for the other.

The interface is MemoValeOS's own: request and response shapes are defined here and in
[[Knowledge-OS/Schema/Provider-Mapping]], not by any one consumer. A new consumer adapts to this
contract; the contract does not grow consumer-specific fields.

## Transport

`Knowledge-OS/Tools/context-provider.mjs` accepts one protocol `1.0` request as UTF-8 JSON on stdin
and returns one JSON response on stdout. It is launched as an argv process, never through a shell.
The caller supplies an authorized project root and the MemoValeOS vault root:

```text
node <vault>/Knowledge-OS/Tools/context-provider.mjs \
  --project-root <project> --vault-root <vault>
```

The vault must be inside the project root and contain sibling `Knowledge-OS/` and `Project-OS/`
directories, `CLAUDE.md`, and the Context Selection Protocol. Obsidian and its MCP server are not
required.

## Request envelope

Every request carries `request_id`, `provider_id` (`memovale`), `operation`,
`message_type: "request"`, `protocol_version: "1.0"`, a `payload` object, and an
`adapter_extensions` object for caller-specific data the provider ignores. Every response echoes
`request_id` and `provider_id` and carries a `status` of `ok`, `degraded`, or `error`, with
`warnings` and `errors` lists. The executable reference for exact shapes is
`context-provider.test.mjs`.

## Operations

- `capabilities` reports `read_only` and `propose`, a durable filesystem source, and no
  `managed_write` capability.
- `health` checks the filesystem layout only.
- `prepare_context` requires a context plan (budget and vault-relative entry points).
- `checkpoint` records source identity, path, Git revision, and digest only.
- `restore` re-resolves every path and digest; changed or missing sources fail closed.
- `propose_knowledge` validates a knowledge candidate, looks for duplicate headings, maps it to
  MemoValeOS, and returns a proposal without writing a note.

Any request for `managed_write` fails. A proposal is not accepted knowledge, evidence, or approval.

## Retrieval

The provider always begins with `CLAUDE.md` and
[[Knowledge-OS/Protocols/Context-Selection-Protocol]]. It then follows only the explicit entry
points supplied for the Task. Entry points cannot be absolute, traverse upward, or escape through a
symbolic link.

Selection stops at the plan's file or byte budget. Files that do not fit are returned as named
omissions; truncation produces `degraded`, never a silent `ok`. Each selected source returns:

- a project-relative path and vault-native path;
- the project Git revision;
- a SHA-256 content digest;
- observation time;
- type, lifecycle, status, evidence level, stale marker, and update date when frontmatter provides
  them.

Stale and draft sources and duplicate selected headings are explicit warnings. Superseded and
archived candidates are omitted from current context. The provider does not load the
whole vault to make an implicit relevance decision: the caller selects candidate areas from the
Task's target facts, and the provider enforces that boundary.

## Authority

MemoValeOS project knowledge can constrain implementation when its lifecycle and evidence make it
current, but the provider response itself is not evidence of the caller's outcome. The caller must
still verify observable claims against the relevant surface and environment.

Knowledge promotion follows [[Knowledge-OS/Schema/Provider-Mapping]] and the existing
Knowledge Promotion Protocol. Decisions, Architecture, Product intent, rules, and every ambiguous
duplicate require human review. No operation in provider version `0.1.0` promotes a proposal.

That last sentence is a property of this version, not a guarantee of the next one, and it is the
hinge the whole arrangement turns on. A proposal that arrives at `lifecycle: draft` and waits for a
human leaves the draft/active distinction intact; a proposal applied automatically would make an
external system a writer of this project's knowledge, and the distinction would stop meaning
anything. Automating acceptance — for any consumer — is therefore a change to how knowledge becomes
true here: it requires an explicit Decision, not a code change. Recorded in
[[Knowledge-OS/Rules/AI-Governance]] under Must Not.

## Failure behavior

Invalid identity, protocol, roots, paths, budgets, checkpoints, candidates, or unsupported writes
return a structured `error` response. Budget omissions, stale selected knowledge, or potential
contradictions return `degraded` with the reason preserved. The caller must not reinterpret either
state as a successful complete retrieval.
