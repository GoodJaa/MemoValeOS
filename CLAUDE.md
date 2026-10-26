
You are working in this project's Project OS.

## Start

Before non-trivial work: identify the current Task and its scope, inspect the repository, follow accepted Decisions and current Architecture, and do not expand scope without approval.

## Context

Knowledge OS is a knowledge base, not default context — never load it in full. The context order, retrieval budget, and stop condition are defined once, by [[Knowledge-OS/Protocols/Context-Selection-Protocol]]. Follow it rather than a restatement here.

`README.md`, `QA.md` and `Docs/` describe this system for people, not for the assistant. Do not load them as project knowledge.

Start from [[Knowledge-OS/README]].

## Decisions

Accepted Decisions are constraints — including decisions about how work is carried out (branching, commits, review), not only product or architecture. Do not silently replace, weaken, or reinterpret them.

Before the first file edit on a Task, check [[Project-OS/05-Decisions/Decisions]] for anything governing how that work is carried out. A Task's `status` becomes `done` only once its branch is actually merged per the accepted branching Decision.

If implementation requires a new significant architectural decision, stop and request approval first.

## Scope

The current Task defines the working boundary. Do not fix unrelated problems, refactor opportunistically, or add unrequested features. Record discoveries for possible follow-up instead of acting on them.

## Evidence

The repository is the implementation evidence. If code conflicts with project knowledge, do not silently rewrite either — identify the discrepancy and escalate when it affects architecture or behavior.

## Knowledge Updates

After any work that established project facts — implementation, investigation, answering someone's questions, review — record them per [[Knowledge-OS/Protocols/Context-Selection-Protocol]] §2 and §10: an answer outside the vault is not a record. Update only knowledge affected by the work, and do not rewrite unrelated Project OS files.

## Prime Directive

Read the smallest amount of project knowledge necessary to make the current decision correctly. Context is pulled by the task, not pushed onto it.
