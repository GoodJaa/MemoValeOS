#!/usr/bin/env node
/**
 * task-lookup.mjs — which Task this working copy is on, which Tasks are free,
 * which are taken, and which comes next, without asking who anyone is.
 *
 * Until this existed the next Task was one Grep over the working copy's
 * frontmatter, and its answer was written into Current-Context.md at every
 * close. With one person that was enough. With several it fails twice. Two
 * people closing sessions on two branches rewrite the same file, so every
 * merge conflicts and one side's state is lost. And the Grep gives both of
 * them the same Task, because a Task taken on someone else's branch still
 * reads `todo` here until that branch is merged: in Archi T35 reached
 * `review` on its branch on 2026-10-12 and the lookup on `master` kept
 * offering it.
 *
 * The owner's requirements (2026-10-26): nothing depends on how a team uses
 * branches, knowledge stays common to every person and agent, and nothing is
 * tied to a person. So:
 *   - A Task is open unless its status is `done` or `cancelled`, free while it
 *     is `todo`, and taken once work has started — any other status — here or
 *     on any branch git can see that is not merged into HEAD, local and
 *     remote-tracking alike. Who took it is not recorded: the commit that
 *     changed the status already says.
 *   - `done` or `cancelled` here closes a Task whatever a branch says. A
 *     squash-merged branch is never an ancestor of HEAD, so its stale
 *     `in-progress` would otherwise keep a finished Task taken forever.
 *   - Which Task this working copy is on is a cursor, not knowledge. It lives
 *     inside git's own directory (`git rev-parse --git-path mvos/cursor.json`):
 *     one per worktree, never tracked, nothing to ignore. Without git it is
 *     `.mvos/cursor.json` in the vault.
 *   - Next: this copy's Task while it is open. Otherwise, with
 *     `tasks.next: lowest-number`, the lowest-numbered Task that is free
 *     everywhere; with `explicit`, none — a human names it.
 *   - A taken Task whose file has not changed for `tasks.staleDays` days (14
 *     by default) is reported as possibly abandoned. The date is the last
 *     commit that touched the file on the ref where it is taken.
 *
 * What git cannot see — a claim not yet pushed, a branch not yet fetched — no
 * one can see. That is git's boundary, not a way of working; `git fetch` is
 * the remedy, and this script does not fetch.
 *
 * Usage:
 *   node "Knowledge-OS/Tools/task-lookup.mjs"                  # the report
 *   node "Knowledge-OS/Tools/task-lookup.mjs" --json
 *   node "Knowledge-OS/Tools/task-lookup.mjs" --take <task> [--force]
 *   node "Knowledge-OS/Tools/task-lookup.mjs" --release
 *
 * <task> is a file name with or without `.md`, its number (`T36`) or its
 * `key`. --take writes the cursor and nothing else: setting the status and
 * sharing it is the first step of the work, not this script's. It refuses a
 * Task taken anywhere else unless --force — which is also how a copy takes
 * back its own unfinished Task after the cursor was lost.
 *
 * Exit codes: 0 report, taken or released; 1 no Tasks folder, <task> matches
 * no Task or more than one, the Task is closed, or it is taken elsewhere and
 * --force was not given.
 */
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync, rmSync, realpathSync } from "node:fs";
import { join, dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { load as loadYaml } from "./vendor/js-yaml.mjs";

const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TASKS = join(VAULT, "Project-OS", "03-Development", "Tasks");
const CURRENT_CONTEXT = join(VAULT, "Project-OS", "06-AI", "Context", "Current-Context.md");
const CLOSED = ["done", "cancelled"];
const FREE = ["todo"];
const STALE_DAYS = 14;
/* Ref names in one `git grep`: the command line of Windows is short. */
const REF_BATCH = 50;

/* ------------------------------------------------------------ pure parts */

const norm = (s) => s.replace(/\r\n/g, "\n");

function frontmatter(text) {
  const t = norm(text);
  if (!t.startsWith("---\n")) return null;
  const end = t.indexOf("\n---", 3);
  if (end === -1) return null;
  try {
    return loadYaml(t.slice(4, end)) ?? {};
  } catch {
    return null;
  }
}

/* `T36-Graph-View` → 36; a name without a leading number sorts after all
 * numbered ones, by name. */
export function numberOf(name) {
  const m = /^[A-Za-z]*-?(\d+)/.exec(name);
  return m ? Number(m[1]) : Infinity;
}

export const byNumber = (a, b) => numberOf(a) - numberOf(b) || a.localeCompare(b);

/* The `## Current Task` and `## Current Goal` sections are what made
 * Current-Context.md one person's session state; a note that still has them
 * was written before the shared shape. */
export function currentContextShape(text) {
  if (text === null) return "absent";
  return /^## (Current Task|Current Goal)\s*$/m.test(norm(text)) ? "old" : "shared";
}

/* `git grep -z` over trees prints `<ref>:<path>\0<line>`; a ref name cannot
 * hold a colon. Only the first `status:` line of each file counts: that is the
 * frontmatter's, which comes first. */
export function parseGrep(out) {
  const seen = new Map();
  for (const line of out.split("\n")) {
    const nul = line.indexOf("\0");
    if (nul === -1) continue;
    const where = line.slice(0, nul);
    const colon = where.indexOf(":");
    const ref = where.slice(0, colon);
    const path = where.slice(colon + 1);
    const key = `${ref}\0${path}`;
    if (seen.has(key)) continue;
    const status = line.slice(nul + 1).replace(/^status:\s*/, "").replace(/["'\s]+/g, "");
    seen.set(key, { ref, path, name: path.split("/").pop().replace(/\.md$/, ""), status });
  }
  return [...seen.values()];
}

/* Find the Task <query> names: its file name, its number, or its key. */
export function resolveTask(tasks, query) {
  const q = String(query).replace(/\.md$/, "");
  const exact = tasks.filter((t) => t.name === q || t.key === q);
  if (exact.length) return exact;
  return tasks.filter((t) => t.name.startsWith(`${q}-`));
}

/*
 * The whole answer from plain data, so it can be tested without git:
 *   tasks  — [{name, status, key}] of the working copy;
 *   remote — [{ref, name, status}] Tasks with started work on refs not merged into HEAD;
 *   cursor — the Task name this copy is on, or null;
 *   dates  — name → {ref|"here": "YYYY-MM-DD"}, the last commit to the file;
 *   next   — "lowest-number" | "explicit"; staleDays; today.
 */
export function classify({ tasks, remote = [], cursor = null, dates = {}, next = "lowest-number", staleDays = STALE_DAYS, today }) {
  const here = new Map(tasks.map((t) => [t.name, t]));
  const open = tasks.filter((t) => !CLOSED.includes(t.status));
  const age = (date) => (date && today ? Math.floor((Date.parse(today) - Date.parse(date)) / 86400000) : null);
  const takenAt = new Map();
  const add = (name, status, where) => {
    const date = dates[name]?.[where] ?? null;
    const days = age(date);
    const entry = { where, status, date, days, stale: days !== null && days >= staleDays };
    takenAt.set(name, [...(takenAt.get(name) ?? []), entry]);
  };
  for (const t of open) if (!FREE.includes(t.status)) add(t.name, t.status, "here");
  for (const r of remote) {
    const local = here.get(r.name);
    if (local && CLOSED.includes(local.status)) continue;
    if (CLOSED.includes(r.status) || FREE.includes(r.status)) continue;
    add(r.name, r.status, r.ref);
  }

  const mine = cursor ? here.get(cursor) ?? null : null;
  const cursorState = !cursor ? null : !mine ? { task: cursor, state: "missing" } : CLOSED.includes(mine.status) ? { task: cursor, state: "closed", status: mine.status } : { task: cursor, state: "open", status: mine.status };

  const taken = [...takenAt.entries()]
    .filter(([name]) => !(cursorState?.state === "open" && name === cursor))
    .map(([name, at]) => ({ name, onThisBranch: here.has(name), at }))
    .sort((a, b) => byNumber(a.name, b.name));
  const free = open.filter((t) => FREE.includes(t.status) && !takenAt.has(t.name) && !(cursorState?.state === "open" && t.name === cursor)).map((t) => t.name).sort(byNumber);

  let chosen;
  if (cursorState?.state === "open") chosen = { task: cursor, why: "this working copy's Task" };
  else if (next === "explicit") chosen = { task: null, why: "tasks.next is explicit: a human names the Task" };
  else if (free.length) chosen = { task: free[0], why: "the lowest-numbered free Task" };
  else chosen = { task: null, why: "no Task is free" };

  return { openCount: open.length, cursor: cursorState, taken, free, next: chosen };
}

/* ----------------------------------------------------------------- reading */

function config() {
  try {
    const c = JSON.parse(readFileSync(join(VAULT, "mvos.config.json"), "utf8"))?.tasks ?? {};
    const next = c.next ?? (c.keying === "external" ? "explicit" : "lowest-number");
    return { next, staleDays: Number.isInteger(c.staleDays) && c.staleDays > 0 ? c.staleDays : STALE_DAYS };
  } catch {
    return { next: "lowest-number", staleDays: STALE_DAYS };
  }
}

function readTasks() {
  return readdirSync(TASKS)
    .filter((n) => n.endsWith(".md"))
    .map((n) => {
      const fm = frontmatter(readFileSync(join(TASKS, n), "utf8")) ?? {};
      return { name: n.replace(/\.md$/, ""), status: String(fm.status ?? ""), key: typeof fm.key === "string" ? fm.key : null };
    });
}

function git(args, cwd = VAULT) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
}

/* null outside git. `head` is false in a repository with no commit yet:
 * there is a git directory for the cursor, but nothing to compare refs with. */
function gitState() {
  let top;
  try {
    top = git(["rev-parse", "--show-toplevel"]).trim();
  } catch {
    return null;
  }
  let head = true;
  try {
    git(["rev-parse", "--verify", "--quiet", "HEAD"]);
  } catch {
    head = false;
  }
  const tasksPath = relative(top, realpathSync(TASKS)).split(sep).join("/");
  return { top, tasksPath, head };
}

/* Tasks with started work on every local and remote-tracking ref that HEAD
 * does not contain. `refs/remotes/<remote>/HEAD` is an alias, skipped. */
function remoteTasks(state) {
  const refs = git(["for-each-ref", "--no-merged", "HEAD", "--format=%(refname)", "refs/heads", "refs/remotes"], state.top)
    .split("\n")
    .filter((r) => r && !/^refs\/remotes\/[^/]+\/HEAD$/.test(r));
  const out = [];
  for (let i = 0; i < refs.length; i += REF_BATCH) {
    let text = "";
    try {
      text = git(["grep", "-z", "-I", "-e", "^status:", ...refs.slice(i, i + REF_BATCH), "--", `${state.tasksPath}/*.md`], state.top);
    } catch {
      continue; // exit 1: no match on these refs
    }
    out.push(...parseGrep(text).map((r) => ({ ...r, ref: r.ref.replace(/^refs\/(heads|remotes)\//, "") })));
  }
  return out.filter((r) => r.path === `${state.tasksPath}/${r.name}.md`);
}

/* The last commit to a Task's file on `ref`. Here, an uncommitted edit is
 * newer than any commit: a status just set is not an old one. */
function lastChange(state, ref, name, today) {
  const path = `${state.tasksPath}/${name}.md`;
  if (ref === "HEAD") {
    try {
      git(["diff", "--quiet", "HEAD", "--", path], state.top);
    } catch {
      return today;
    }
  }
  try {
    return git(["log", "-1", "--format=%cs", ref, "--", path], state.top).trim() || null;
  } catch {
    return null;
  }
}

function cursorPath(state) {
  if (!state) return join(VAULT, ".mvos", "cursor.json");
  return resolve(VAULT, git(["rev-parse", "--git-path", "mvos/cursor.json"]).trim());
}

function readCursor(path) {
  try {
    const c = JSON.parse(readFileSync(path, "utf8"));
    return typeof c?.task === "string" ? c : null;
  } catch {
    return null;
  }
}

function lookup() {
  const cfg = config();
  const tasks = readTasks();
  const state = gitState();
  const remote = state?.head ? remoteTasks(state) : [];
  const path = cursorPath(state);
  const cursor = readCursor(path);
  const today = new Date().toISOString().slice(0, 10);

  /* Dates only for what is taken: one `git log` per taken Task, not per Task. */
  const dates = {};
  if (state?.head) {
    const started = (s) => s && !CLOSED.includes(s) && !FREE.includes(s);
    for (const t of tasks.filter((x) => started(x.status))) (dates[t.name] ??= {}).here = lastChange(state, "HEAD", t.name, today);
    for (const r of remote.filter((x) => started(x.status))) (dates[r.name] ??= {})[r.ref] = lastChange(state, r.ref, r.name, today);
  }
  let cc = null;
  try {
    cc = readFileSync(CURRENT_CONTEXT, "utf8");
  } catch {
    /* absent */
  }
  const result = classify({ tasks, remote, cursor: cursor?.task ?? null, dates, next: cfg.next, staleDays: cfg.staleDays, today });
  return { result, tasks, cfg, git: Boolean(state), cursorFile: path, cursor, currentContext: currentContextShape(cc) };
}

/* ------------------------------------------------------------------- run */

const TOOL = 'node "Knowledge-OS/Tools/mv.cjs" task-lookup';

function report(l) {
  const { result: r, cfg } = l;
  const lines = [];
  lines.push(`Tasks: ${l.tasks.length}, ${r.openCount} open. Next is chosen by tasks.next = ${cfg.next}.${l.git ? "" : " Not a git repository: branches are not looked at."}`);
  lines.push("");
  if (!r.cursor) lines.push("This working copy is on no Task.");
  else if (r.cursor.state === "open") lines.push(`This working copy is on ${r.cursor.task} (${r.cursor.status}), taken ${l.cursor.taken ?? "on an unknown date"}.`);
  else if (r.cursor.state === "closed") lines.push(`This working copy was on ${r.cursor.task}, which is now ${r.cursor.status}. Release it: ${TOOL} --release`);
  else lines.push(`This working copy is on ${r.cursor.task}, which is not in ${relative(VAULT, TASKS)}. Release it, or take the Task's new name.`);

  if (r.taken.length) {
    lines.push("", "Taken, not by this working copy:");
    for (const t of r.taken) {
      for (const a of t.at) {
        const where = a.where === "here" ? "here" : `on ${a.where}`;
        const when = a.date ? `, last changed ${a.date}` : "";
        const stale = a.stale ? ` — unchanged for ${a.days} days; possibly abandoned` : "";
        lines.push(`  ${t.name}  ${a.status}  ${where}${when}${stale}${t.onThisBranch ? "" : "  (not on this branch)"}`);
      }
    }
    if (!r.cursor && r.taken.some((t) => t.at.some((a) => a.where === "here"))) {
      lines.push(`  If one taken here is this working copy's own unfinished work: ${TOOL} --take <task> --force`);
    }
  }
  lines.push("", r.free.length ? `Free (${r.free.length}): ${r.free.join(", ")}` : "Free: none");
  lines.push("", r.next.task ? `Next: ${r.next.task} — ${r.next.why}.` : `Next: none — ${r.next.why}.`);
  if (r.next.task && r.cursor?.state !== "open") lines.push(`  Take it when work starts: ${TOOL} --take ${r.next.task}`);
  if (l.currentContext === "old") {
    lines.push("", "Current-Context.md still has `## Current Task` or `## Current Goal`: it predates the shared shape.");
    lines.push("  Move it as Project-OS/06-AI/AI.md, \"Current Context from before os-v8\", says.");
  }
  console.log(lines.join("\n"));
}

function main() {
  const argv = process.argv.slice(2);
  const value = (n) => {
    const i = argv.indexOf(n);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  };
  const fail = (msg) => {
    console.error(msg);
    process.exit(1);
  };
  if (!existsSync(TASKS)) fail(`no Tasks folder at ${TASKS}`);
  const l = lookup();

  if (argv.includes("--release")) {
    rmSync(l.cursorFile, { force: true });
    console.log(l.cursor ? `This working copy is no longer on ${l.cursor.task}.` : "This working copy was on no Task.");
    return;
  }

  if (argv.includes("--take")) {
    const q = value("--take");
    if (!q) fail("--take needs a Task: its file name, number or key");
    const found = resolveTask(l.tasks, q);
    if (found.length === 0) fail(`no Task matches \`${q}\` in ${relative(VAULT, TASKS)}`);
    if (found.length > 1) fail(`\`${q}\` matches ${found.length} Tasks: ${found.map((t) => t.name).join(", ")}; name one`);
    const task = found[0];
    if (CLOSED.includes(task.status)) fail(`${task.name} is ${task.status}; there is nothing to take`);
    const elsewhere = l.result.taken.find((t) => t.name === task.name);
    if (elsewhere && !argv.includes("--force")) {
      const at = elsewhere.at.map((a) => `${a.status} ${a.where === "here" ? "here" : `on ${a.where}`}${a.date ? ` since ${a.date}` : ""}`).join("; ");
      fail(
        `${task.name} is taken: ${at}.\n` +
          `Someone else may be on it. If it is this working copy's own unfinished work — taken before the cursor existed, or the cursor was lost — take it with --force.`
      );
    }
    mkdirSync(dirname(l.cursorFile), { recursive: true });
    writeFileSync(l.cursorFile, JSON.stringify({ task: task.name, taken: new Date().toISOString().slice(0, 10) }, null, 2) + "\n", "utf8");
    console.log(`This working copy is on ${task.name}.`);
    if (FREE.includes(task.status)) {
      console.log("Set `status: in-progress` in its note and commit it: others see the claim once that commit reaches a branch they fetch.");
    }
    return;
  }

  if (argv.includes("--json")) {
    console.log(
      JSON.stringify({ vault: VAULT, git: l.git, rule: l.cfg.next, staleDays: l.cfg.staleDays, cursorFile: l.cursorFile, cursorTaken: l.cursor?.taken ?? null, currentContext: l.currentContext, ...l.result }, null, 2)
    );
    return;
  }
  report(l);
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
