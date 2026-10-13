---
type: readme
status: active
lifecycle: active
---
# Knowledge OS

Knowledge OS defines the structure, rules and protocols used to manage project knowledge.

## System Layers

- [[Schema/Knowledge-Types]] — knowledge entities.
- [[Schema/Metadata-Schema]] — entity metadata.
- [[Schema/Relationship-Types]] — semantic relationships.
- [[Schema/Knowledge-Lifecycle]] — knowledge states and lifecycle.
- [[Schema/Evidence-Schema]] — how strongly a statement is established.
- [[Rules/Brain-Rules]] — rules for project knowledge.
- [[Rules/Context-Rules]] — rules for context selection.
- [[Rules/Linking-Rules]] — rules for semantic links.
- [[Rules/Promotion-Rules]] — rules for knowledge promotion.
- [[Rules/AI-Governance]] — boundaries of Claude autonomy.
- [[Rules/Communication-Rules]] — language of communication with the human owner.
- [[Protocols/Context-Selection-Protocol]] — select context for a task.
- [[Protocols/Knowledge-Promotion-Protocol]] — promote relevant discoveries.
- [[Protocols/Project-Initialization-Protocol]] — initialize project knowledge.
- [[Protocols/Repository-Survey-Protocol]] — map an existing codebase.
- [[Protocols/Deployment-Protocol]] — install the OS layer's files into an existing project.
- [[Protocols/Relationship-Discovery-Protocol]] — discover relevant relationships.
- [[Protocols/Knowledge-Maintenance-Protocol]] — verify knowledge against its schema.

## Tools

`Tools/validate-vault.mjs` checks the vault against this schema deterministically. Run it with `node`, from the vault root.

## Navigation

Start with [[Context-Index]] to locate project knowledge. The procedure for expanding from there — what to load, in what order, and when to stop — is defined once, by [[Protocols/Context-Selection-Protocol]].

## Boundary

Knowledge OS defines how knowledge is managed.

Project OS contains project-specific knowledge.

Repository code is implementation evidence.

Do not load Knowledge OS or Project OS in full unless explicitly required.
