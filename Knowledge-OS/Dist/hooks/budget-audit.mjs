#!/usr/bin/env node
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
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* fileURLToPath, not `new URL(...).pathname`: the latter leaves a file URL's
 * percent-encoding in place, so any directory with a space in it arrives as
 * `%20` and the resolved root is a path that does not exist. This hook exits 0
 * on every path by design, so it would not have complained — it would simply
 * have recorded the wrong thing. */
const FALLBACK_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return; // No stdin, or not JSON. Not our business to complain.
  }

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
  } catch {
    budget = null;
  }

  const target = firstPath(payload.tool_name, payload.tool_input);
  if (target === null) return; // A search with no path argument: no target to score.

  const entryPoints = Array.isArray(budget?.entryPoints) ? budget.entryPoints : [];
  const rel = toRelative(target, root);

  const record = {
    at: new Date().toISOString(),
    session: payload.session_id ?? null,
    /* Present only on a subagent's calls — the main session has neither field.
     * Context Selection Protocol says delegating the search does not delegate
     * the budget; recording this is what makes that claim checkable instead of
     * aspirational. */
    agent: payload.agent_type ?? null,
    agentId: payload.agent_id ?? null,
    tool: payload.tool_name ?? null,
    path: rel,
    declared: budget !== null,
    task: budget?.task ?? null,
    withinBudget: budget === null ? null : entryPoints.some((e) => matches(rel, e)),
  };

  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, JSON.stringify(record) + "\n");
  } catch {
    // Logging failed. Still not our business to interrupt the session.
  }
}

/** The one path a read addresses, or null when the call names none. */
function firstPath(tool, input) {
  if (!input || typeof input !== "object") return null;
  if (tool === "Read") return input.file_path ?? null;
  // Grep and Glob may omit `path` entirely — an unscoped search over the whole
  // tree. That is a different failure from reading the wrong file, and
  // context-metrics.mjs already counts it as `unscopedSearches`; scoring it
  // here as "outside budget" would double-count the same behaviour.
  if (tool === "Grep" || tool === "Glob") return input.path ?? null;
  return null;
}

function toRelative(p, root) {
  const norm = String(p).split("\\").join("/");
  const rootNorm = String(root).split("\\").join("/").replace(/\/+$/, "");
  return norm.toLowerCase().startsWith(rootNorm.toLowerCase() + "/")
    ? norm.slice(rootNorm.length + 1)
    : norm;
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

main();
process.exit(0);
