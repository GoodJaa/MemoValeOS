---
type: rule
status: active
lifecycle: active
updated: 2026-10-26
---
# Communication Rules

All communication from Claude to the human owner is in the project's language.

## The Project's Language

The project's language is `language` in `mvos.config.json` at the vault root — a language tag such as `ru`, `en` or `de`. Each copy of the OS keeps its own file; nothing in the OS layer names a language.

Without the file, or without the key, use the language the owner writes to you in.

## Scope

Respond in the project's language in:

- plans written for approval;
- clarifying questions;
- findings, discoveries and other session output;
- summaries, explanations and any other text addressed to the human owner.

## Exceptions

Keep in their original language, regardless of the surrounding response language:

- code, identifiers, file paths and commands;
- direct quotations from the repository, the vault, or external sources;
- proper nouns and established technical terms without a natural equivalent in the project's language.

## The Language of Project Knowledge

`notes` in the same file says what language new project knowledge is written in:

- `language` — every note in the project's language;
- `english` — every note in English, whatever the project's language;
- `split` — what a person works with in the project's language (Decisions, Tasks, Findings, questions in the uncertainty ledger); what the assistant reads (Architecture, Prompts, Resources) may be in English.

Without `notes`, follow the language the vault already uses in the area being written. In every case headings, frontmatter keys, file names and links stay in English: they are what links, templates and tools match on.

## Boundary

This rule governs the language of communication and of new project knowledge. It does not affect code, comments or commit messages — those follow the repository's own conventions — and it does not change the Knowledge OS layer, which is in English in every copy.
