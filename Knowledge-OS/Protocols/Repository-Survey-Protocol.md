---
type: protocol
status: active
lifecycle: active
---
# Repository Survey Protocol

Build the first map of an existing codebase without reading all of it.

[[Project-Initialization-Protocol]] assumes the system structure is already known. On an existing repository it is not. This protocol is how it becomes known.

## 1. When

Run a survey when:

- Project OS is being initialized over a repository that already exists;
- an area of the system has never been mapped and a Task is about to touch it.

Do not run a survey during ordinary Task work. A Task uses [[Context-Selection-Protocol]], which reads less by design.

A survey is a separate activity with its own budget. Say which one is running.

## 2. Mode

Two modes exist. The project selects one; the default is `entry-points`.

- `entry-points` — survey outward from the system's edges, as defined below. No approval needed.
- `budgeted` — present a plan and wait for the human owner to approve it before reading.

The active mode is recorded in the project's own AI note. Follow whichever is set there.

Switching modes changes only who decides the budget. Everything else in this protocol applies to both.

## 3. Survey in `entry-points` Mode

Read outward from the edges of the system, not downward into it.

In order:

1. **Manifests** — build files, dependency lists, package definitions, container and deployment descriptors.
2. **Entry points** — executables, routes, endpoints, scheduled jobs, message consumers, CLI commands.
3. **Module boundaries** — top-level directories, published interfaces, package exports.
4. **External edges** — data stores, third-party services, queues, file systems.
5. **Configuration** — environments, feature switches, secrets layout by name only.

Stop there.

- Do not descend into implementation.
- Do not read a file because it is large or interesting.
- Do not follow a call chain past a module boundary.

The survey answers *what the parts are and where they meet*. It does not answer *how any part works*. That question belongs to a Task.

## 4. Survey in `budgeted` Mode

Before reading, present:

- the areas to be surveyed;
- the files or globs to be read;
- the expected volume;
- the stop condition;
- what will be produced.

Wait for approval. Read only what was approved.

If the plan turns out to be wrong, stop and present a revised one. Do not silently widen it.

## 5. Record

Produce, from the survey:

- one `Architecture` entity per boundary found;
- an entry in the project's uncertainty ledger for every question the survey raised and could not answer;
- `Research` entities only for findings that required investigation beyond reading;
- the project's Environment note, from `Templates/Environment.md`, at `Project-OS/06-AI/Context/Environment.md`, routed from the AI context index: how to install, test, lint, build and run, which Node and package manager, which services exist and where their credentials live — by name, never by value. The manifests and configuration read in §3 hold most of it. Run each row's command once and record the date: those rows are `L2`; a row only read stays `L1`. These are the only commands a survey runs.

Every entity produced by a survey:

- has `lifecycle: draft`;
- carries evidence level `L1`, because it rests on reading;
- marks as `inferred` any statement that was reasoned rather than observed.

A survey cannot produce a `Decision`. It finds what the code does, not what anyone chose. Where a choice is evident but its rationale is not, record the constraint and an uncertainty about why it exists.

## 6. Granularity

One `Architecture` entity per boundary that could be replaced independently: a service, a module with a stable interface, a data store, an integration.

- Not one per file, class, or function. Those are code, and code is evidence rather than knowledge.
- If an entity cannot state its responsibility in one sentence, it covers too much.
- If two entities always change together, they are one boundary.
- On a large system, prefer fewer and larger entities. A map with twenty legible nodes is worth more than one with three hundred faithful ones.

## 7. Confirm

A survey ends at `L1`. The map is a reading of the code, not an observation of the system.

Raise a boundary to `L2` when its behavior is observed: a test exercising it, a log from a real run, a command whose output shows it working. Raise it to `L3` when the behavior is observed on the surface a user reaches.

Follow [[Evidence-Schema]]. Architecture cannot become `active` at `L1` alone.

Confirm the boundaries the current work depends on. Leave the rest at `L1` until something needs them.

## 8. Conflict

Existing documentation in the repository is not evidence. It records what was once intended.

When documentation and code disagree, the code is what runs. Record the disagreement as an uncertainty rather than choosing silently. Follow [[Rules/Brain-Rules]].

## Boundary

This protocol produces the initial map of a system.

It does not implement, refactor, judge quality, or plan work.

## Principle

Map the edges first. Depth is bought by a Task, not spent in advance.
