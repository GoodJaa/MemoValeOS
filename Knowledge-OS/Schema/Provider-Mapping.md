---
type: schema
status: active
lifecycle: active
created: 2026-09-12
updated: 2026-10-01
---
# Provider Mapping

This page maps the objects of the [[Knowledge-OS/Protocols/Context-Provider-Protocol]] to MemoValeOS. It does not add new
MemoValeOS entity types or bypass the existing lifecycle and evidence rules.

## Context output

| Response field | MemoValeOS source | Meaning |
|---|---|---|
| reference `path` | path relative to the containing project | Restorable filesystem identity |
| reference `native_id` | path relative to the vault | MemoValeOS identity used for duplicate and lifecycle review |
| reference `revision` | containing repository `HEAD` | Repository state at retrieval |
| reference `digest` | SHA-256 of file bytes | Exact source state at retrieval |
| source `type` | frontmatter `type` | Entity class from `schema.json` |
| source `lifecycle` | frontmatter `lifecycle` | Whether the note is draft, current, superseded, or archived |
| source `evidence` | frontmatter `evidence` | How strongly the note was established |
| source `stale` | frontmatter `stale` | Explicit freshness warning |

A reference proves which file was selected. It does not prove that every statement in the file is
true or that the caller's outcome happened.

## Knowledge candidate mapping

| Candidate `kind` | MemoValeOS proposal type | Suggested area | Minimum candidate evidence |
|---|---|---|---|
| `finding` | `finding` | `Project-OS/03-Development/Findings` | L1 |
| `incident` | `finding` | `Project-OS/03-Development/Findings` | L1 |
| `skill_change` | `finding` | `Project-OS/03-Development/Findings` | L1 |
| `eval` | `research` | `Project-OS/04-Research` | L1 |
| `decision` | `decision` | `Project-OS/05-Decisions` | L2 and human acceptance |
| `architecture` | `architecture` | `Project-OS/02-Architecture` | L2 and human acceptance |
| `rule` | `rule` | `Knowledge-OS/Rules` | human review of the system layer |
| `intent` | `product` | `Project-OS/01-Product` | L4 and human ownership |

The provider validates the mechanical minimum and returns `requires_human: true`. The proposal must
still pass [[Knowledge-OS/Protocols/Knowledge-Promotion-Protocol]] before it becomes `active`.
Decision and Architecture proposals start as `draft`; a provider cannot mark them accepted.

## Duplicate handling

Duplicate lookup compares the candidate title with the first level-one heading of existing notes.
Matches are returned as `duplicate_paths`. A duplicate does not cause an overwrite or an automatic
merge. The reviewer chooses whether to update, supersede, link, or reject the proposal.

## Write boundary

`read_only` may select sources. `propose` may return a structured proposal. `managed_write` is not a
MemoValeOS provider capability in v1 and must fail closed.
