#!/usr/bin/env node
/* eslint-disable -- deployed into a host project's .claude/hooks/, where the
 * host's linter has no say over it: flat-config ESLint lints dot-directories,
 * and its rules (Node globals, `catch (e)` the ES2017 syntax here requires)
 * would fail the host's lint, and its CI, on a file it does not own. */
/**
 * B6 — make the retrieval budget measurable.
 *
 * `Context Selection Protocol` §2 requires declaring a reading budget — target
 * facts, entry points, stop condition — before reading anything. It is the most
 * valuable rule in the system and the only one nothing checks: BEHAV-7 in QA.md
 * has carried ⚠️ since it was written and went unverified through twelve tasks.
 *
 * This hook LOGS. It never blocks, and that restraint is the point: nobody knows
 * yet how often the discipline is broken or what breaking it costs, and a rule
 * enforced before it is measured gets disabled the first time it is wrong.
 * Enforcement is B5's question, decided on the numbers this produces.
 *
 * It records one line per Read/Grep/Glob: the path, whether a budget had been
 * declared at all, and whether the path was inside the declared entry points.
 * The interesting number is not reads-outside-budget — it is how often no budget
 * was declared in the first place.
 *
 * Failure policy: never interfere. Every path exits 0, including a corrupt
 * budget file or an unwritable log. A measuring instrument that can break the
 * work it measures would be abandoned, and rightly.
 *
 * CommonJS and ECMAScript 2017, on purpose. The first real installation ran it
 * under the host's Node 12, where the ESM version with `?.` never parsed: it
 * exited 1 before its first line, the "exits 0 on every path" above was false,
 * and nothing was logged for weeks without anyone seeing an error — a non-zero
 * exit from a PreToolUse hook does not block, so it is not shown either. This
 * file parses on Node 8 and later. It does not go through the launcher
 * (Tools/mv.cjs): it runs on every read, and a second process there would
 * cost more than the measurement is worth. The syntax is pinned by a test
 * (budget-audit.test.mjs parses it as ECMAScript 2017).
 */
"use strict";

const fs = require("fs");
const path = require("path");

/* The project root when Claude Code does not say: the hook lives in
 * <root>/.claude/hooks/. */
const FALLBACK_ROOT = path.resolve(__dirname, "..", "..");

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch (e) {
    return; // No stdin, or not JSON. Not our business to complain.
  }
  if (!payload || typeof payload !== "object") return;

  const root = process.env.CLAUDE_PROJECT_DIR || payload.cwd || FALLBACK_ROOT;
  const budgetPath = path.join(root, ".claude", "budget.json");
  const logPath = path.join(root, ".claude", "budget-audit.jsonl");

  /* A budget is per-task, not per-session: one session can carry several tasks,
   * and a budget left over from the previous one is worse than none — it would
   * score this task's reads against a boundary drawn for different work. The
   * declaration therefore carries its own `task`, and every record repeats it.
   * The hook does not judge staleness itself — it cannot know which Task is
   * current. context-metrics.mjs does, afterwards: a record whose `task` names
   * a Task already `done` is reported as a stale budget (`analyseBudget`). */
  let budget;
  try {
    budget = JSON.parse(fs.readFileSync(budgetPath, "utf8"));
  } catch (e) {
    budget = null;
  }
  if (budget !== null && typeof budget !== "object") budget = null;

  const target = firstPath(payload.tool_name, payload.tool_input);
  if (target === null) return; // A search with no path argument: no target to score.

  const entryPoints = budget && Array.isArray(budget.entryPoints) ? budget.entryPoints : [];
  const rel = toRelative(target, root);

  const record = {
    at: new Date().toISOString(),
    session: orNull(payload.session_id),
    /* Present only on a subagent's calls — the main session has neither field.
     * Context Selection Protocol says delegating the search does not delegate
     * the budget; recording this is what makes that claim checkable instead of
     * aspirational. */
    agent: orNull(payload.agent_type),
    agentId: orNull(payload.agent_id),
    tool: orNull(payload.tool_name),
    path: rel,
    declared: budget !== null,
    task: budget ? orNull(budget.task) : null,
    withinBudget: budget === null ? null : entryPoints.some((e) => matches(rel, e)),
  };

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(record) + "\n");
  } catch (e) {
    // Logging failed. Still not our business to interrupt the session.
  }
}

/* `x ?? null`, in the syntax this file is allowed. */
function orNull(x) {
  return x === undefined || x === null ? null : x;
}

/** The one path a read addresses, or null when the call names none. */
function firstPath(tool, input) {
  if (!input || typeof input !== "object") return null;
  if (tool === "Read") return orNull(input.file_path);
  // Grep and Glob may omit `path` entirely — an unscoped search over the whole
  // tree. That is a different failure from reading the wrong file, and
  // context-metrics.mjs already counts it as `unscopedSearches`; scoring it
  // here as "outside budget" would double-count the same behaviour.
  if (tool === "Grep" || tool === "Glob") return orNull(input.path);
  return null;
}

function toRelative(p, root) {
  const norm = String(p).split("\\").join("/");
  const rootNorm = String(root).split("\\").join("/").replace(/\/+$/, "");
  return norm.toLowerCase().startsWith(rootNorm.toLowerCase() + "/") ? norm.slice(rootNorm.length + 1) : norm;
}

/**
 * An entry point names a file or a directory, and a directory covers what is
 * under it: declaring `src/parser/` and then reading three files in it is the
 * budget working, not three violations of it.
 */
function matches(rel, entry) {
  const a = rel.split("\\").join("/").toLowerCase();
  const b = String(entry).split("\\").join("/").toLowerCase().replace(/\/+$/, "");
  return a === b || a.startsWith(b + "/");
}

try {
  main();
} catch (e) {
  /* Whatever went wrong, the read it was observing goes ahead. */
}
process.exit(0);
