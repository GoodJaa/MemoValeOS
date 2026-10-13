---
type: rule
status: active
lifecycle: active
---
# Brain Rules

Project knowledge is the source of truth for project-specific facts, decisions and constraints.

## Use

- Prefer existing project knowledge over assumptions.
- Check relevant knowledge before making project-specific claims.
- Treat accepted Decisions and current Architecture as constraints.
- Use repository code as implementation evidence, at the level defined by [[Schema/Evidence-Schema]].
- Treat historical or archived knowledge as non-authoritative unless explicitly requested.

## Uncertainty

State what is established and what is not.

- Do not resolve a gap in knowledge by writing a confident sentence.
- When tempted to write `probably`, `should`, or `obviously` about this project, record an uncertainty instead.
- An uncertainty that blocks correct work must be surfaced, not carried silently.
- Mark a statement that was reasoned rather than observed as `inferred`. Follow [[Schema/Evidence-Schema]].

## Modify

- Update knowledge only when current work changes or creates project knowledge.
- Modify the smallest affected entity.
- Preserve existing relationships and metadata.
- Do not rewrite unrelated knowledge.
- Reuse existing knowledge instead of creating duplicates.

## Conflicts

When project knowledge conflicts with repository evidence or another authoritative source:

- do not silently choose one;
- identify the conflict;
- use [[Rules/AI-Governance]] for decision authority;
- update knowledge only after the conflict is resolved.

## Scope

Project knowledge must describe this project.

Do not store:

- generic technical knowledge;
- duplicated source code;
- temporary reasoning;
- unverified assumptions.

## Principle

Knowledge records what the project knows.

Code records what the project implements.

Decisions record what the project has accepted.

Evidence records how the project knows it.
