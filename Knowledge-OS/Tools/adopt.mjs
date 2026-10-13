#!/usr/bin/env node
/**
 * adopt.mjs — deploy the OS layer's files into the project root that hosts
 * this vault.
 *
 * The slash commands and the budget hook have to exist under the project
 * root's `.claude/` for Claude Code to load them, and under
 * `Knowledge-OS/Dist/` for delivery to carry them — the root `.claude/` is
 * outside the vault by construction, so one canonical
 * location cannot serve both. This script is what turns the source into the
 * deployed copy; `deployed-command-drift` in validate-vault.mjs is what keeps
 * the two from diverging afterwards.
 *
 * It writes into a tree it does not own. Everything here follows from that:
 *
 *   - The default mode is a plan. Nothing is written without --apply.
 *   - Only `mv-*` names are ever overwritten. That prefix is the reserved
 *     namespace; every other file in `.claude/` belongs to the host project.
 *   - `.claude/agents/` is never touched at all.
 *   - A settings.json that does not parse is left exactly as found. Rewriting
 *     a file you could not read is how an installer destroys someone's work.
 *   - Nothing is ever deleted, staged or committed.
 *
 * The one thing it deliberately does not finish: when the host already had a
 * CLAUDE.md, the body is moved verbatim to Project-OS/Inbox/ and left there.
 * Deciding which of those instructions is a Decision, which is Architecture
 * and which is project convention is judgement, and this script has none.
 *
 * Usage:
 *   node "Knowledge-OS/Tools/adopt.mjs"                       # plan, writes nothing
 *   node "Knowledge-OS/Tools/adopt.mjs" --apply                # apply every class
 *   node "Knowledge-OS/Tools/adopt.mjs" --apply --only commands,hooks
 *   node "Knowledge-OS/Tools/adopt.mjs" --verify               # exit 1 if deployed != source
 *   node "Knowledge-OS/Tools/adopt.mjs" --apply --yes          # overwrite stale mv-* copies
 *   node "Knowledge-OS/Tools/adopt.mjs" --project <dir>        # target root, if not derivable
 *   node "Knowledge-OS/Tools/adopt.mjs" --json
 *
 * Exit codes: 0 nothing to do or done; 1 a precondition failed or --verify
 * found drift; 2 applied, but a step refused (unparseable settings.json, or a
 * stale mv-* copy left alone because --yes was absent).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const DIST = join(VAULT, "Knowledge-OS", "Dist");

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};

const APPLY = flag("--apply");
const VERIFY = flag("--verify");
const YES = flag("--yes");
const JSON_OUT = flag("--json");

const ALL_CLASSES = ["commands", "hooks", "settings", "claude-md", "gitignore"];
const only = value("--only");
const CLASSES = only ? only.split(",").map((c) => c.trim()).filter(Boolean) : ALL_CLASSES;

for (const c of CLASSES) {
  if (!ALL_CLASSES.includes(c)) {
    console.error(`Unknown class \`${c}\`. Known: ${ALL_CLASSES.join(", ")}`);
    process.exit(1);
  }
}

/* ------------------------------------------------------------------ roots */

/* The project root is the git toplevel that contains the vault. When the vault
 * IS the toplevel — a standalone MemoValeOS clone — the two coincide, and
 * deploying into it is still correct: that is how the distribution repository
 * would get its own commands. Falling back to the vault's parent keeps this
 * usable in a tree that is not a git repository at all, which fixtures and
 * throwaway checkouts are. */
function detectProjectRoot() {
  const explicit = value("--project");
  if (explicit) return explicit;
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: VAULT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (top) return top.split("/").join(sep);
  } catch {
    /* not a git repository; fall through */
  }
  return dirname(VAULT);
}

const PROJECT = detectProjectRoot();

/* A vault that sits outside the project root it reports is the one situation
 * worth refusing outright: it means the detection is wrong, and a deploy into
 * the wrong working tree is the failure this whole script exists to avoid. */
if (relative(PROJECT, VAULT).startsWith("..")) {
  console.error(`The vault is not inside the detected project root.`);
  console.error(`  vault   : ${VAULT}`);
  console.error(`  project : ${PROJECT}`);
  console.error(`Pass --project <dir> explicitly rather than letting this guess.`);
  process.exit(1);
}

const CLAUDE_DIR = join(PROJECT, ".claude");

/* ------------------------------------------------------------------ model */

const actions = []; // {cls, kind, path, detail}
const refusals = []; // {cls, path, why}
const notes = []; // informational, no action

const act = (cls, kind, path, detail) => actions.push({ cls, kind, path, detail });
const refuse = (cls, path, why) => refusals.push({ cls, path, why });
const note = (cls, path, detail) => notes.push({ cls, path, detail });

const norm = (s) => s.replace(/\r\n/g, "\n");
const isMv = (n) => /^mv-[^/\\]+\.md$/.test(n);

function readIfExists(p) {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

/* ----------------------------------------------------------- file classes */

/* commands and hooks are the same operation over different name filters, so
 * they share one pass. The filter is what makes collisions tractable: a host
 * project's own `.claude/commands/deploy.md` is never a candidate for anything
 * here, and cannot be. */
function planCopies(cls, subdir, matches) {
  const src = join(DIST, subdir);
  let names;
  try {
    names = readdirSync(src).filter(matches);
  } catch {
    note(cls, relative(VAULT, src), "no such directory in Dist; nothing to deploy");
    return;
  }

  for (const name of names.sort()) {
    const from = join(src, name);
    const to = join(CLAUDE_DIR, subdir, name);
    const source = norm(readFileSync(from, "utf8"));
    const existing = readIfExists(to);

    if (existing === null) {
      act(cls, "create", relative(PROJECT, to), "from Dist");
      continue;
    }
    if (norm(existing) === source) {
      note(cls, relative(PROJECT, to), "already identical");
      continue;
    }
    /* A differing file under the reserved prefix is a stale copy of ours, not
     * the host's work — but it is still a file that exists and that someone
     * may have edited on purpose, so overwriting it is opt-in. */
    if (YES) {
      act(cls, "overwrite", relative(PROJECT, to), "stale mv-* copy replaced (--yes)");
    } else {
      refuse(cls, relative(PROJECT, to), "differs from Dist; pass --yes to overwrite");
    }
  }
}

/* budget-audit.test.mjs stays in Dist so it travels upstream with the hook it
 * tests, but it is this repository's test, not something a host project runs. */
function planHooks() {
  planCopies("hooks", "hooks", (n) => n.endsWith(".mjs") && !n.endsWith(".test.mjs"));
}

/* ------------------------------------------------------------- settings */

/* The hook entry is read from settings.fragment.json rather than written here,
 * so the deployed shape and the source shape cannot drift apart. */
function fragmentHook() {
  const raw = readIfExists(join(DIST, "settings.fragment.json"));
  if (raw === null) return null;
  try {
    const frag = JSON.parse(raw);
    const matcher = frag?.hooks?.PreToolUse?.[0];
    return matcher && matcher.matcher && Array.isArray(matcher.hooks) ? matcher : null;
  } catch {
    return null;
  }
}

function planSettings() {
  const cls = "settings";
  const target = join(CLAUDE_DIR, "settings.json");
  const frag = fragmentHook();
  if (!frag) {
    refuse(cls, relative(VAULT, join(DIST, "settings.fragment.json")), "fragment missing or not valid JSON");
    return null;
  }

  const raw = readIfExists(target);
  if (raw === null) {
    act(cls, "create", relative(PROJECT, target), "hook block from the fragment");
    return { mode: "create", frag, target };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    /* Refuse, loudly, and change nothing. This is the single most destructive
     * thing the script could do, so it is the one place it stops entirely. */
    refuse(cls, relative(PROJECT, target), `not valid JSON (${e.message.split("\n")[0]}); left untouched`);
    return null;
  }

  const command = frag.hooks[0]?.command ?? "";
  const marker = command.match(/[\w-]+\.mjs/)?.[0] ?? "budget-audit.mjs";
  const already = JSON.stringify(parsed).includes(marker);
  if (already) {
    note(cls, relative(PROJECT, target), `already references ${marker}`);
    return null;
  }

  const existingMatcher = (parsed.hooks?.PreToolUse ?? []).find((m) => m?.matcher === frag.matcher);
  act(
    cls,
    "merge",
    relative(PROJECT, target),
    existingMatcher
      ? `append the hook to the existing \`${frag.matcher}\` matcher`
      : `append a new \`${frag.matcher}\` matcher to PreToolUse`
  );
  return { mode: "merge", frag, target, parsed };
}

function applySettings(plan) {
  if (!plan) return;
  if (plan.mode === "create") {
    ensureDir(dirname(plan.target));
    writeFileSync(plan.target, JSON.stringify({ hooks: { PreToolUse: [plan.frag] } }, null, 2) + "\n", "utf8");
    return;
  }
  const obj = plan.parsed;
  obj.hooks = obj.hooks ?? {};
  obj.hooks.PreToolUse = obj.hooks.PreToolUse ?? [];
  const existing = obj.hooks.PreToolUse.find((m) => m?.matcher === plan.frag.matcher);
  if (existing) {
    existing.hooks = existing.hooks ?? [];
    existing.hooks.push(...plan.frag.hooks);
  } else {
    obj.hooks.PreToolUse.push(plan.frag);
  }
  writeFileSync(plan.target, JSON.stringify(obj, null, 2) + "\n", "utf8");
}

/* ------------------------------------------------------------ CLAUDE.md */

const BEGIN = "<!-- MemoValeOS:redirect:begin -->";
const END = "<!-- MemoValeOS:redirect:end -->";

function planClaudeMd() {
  const cls = "claude-md";
  /* Standalone layout: the project root IS the vault, and its CLAUDE.md is the
   * real entry point, not a host file. A redirect there would point at itself
   * and file the actual entry point into the Inbox as if it were foreign. */
  const vaultRel = relative(PROJECT, VAULT).split(sep).join("/");
  if (vaultRel === "") {
    note(cls, "CLAUDE.md", "standalone layout: the vault's own CLAUDE.md is the entry point; no redirect");
    return null;
  }
  const source = readIfExists(join(DIST, "CLAUDE.redirect.md"));
  if (source === null) {
    refuse(cls, relative(VAULT, join(DIST, "CLAUDE.redirect.md")), "redirect source missing");
    return null;
  }
  /* The source names the vault folder as `MemoValeOS/`, the name it has in the
   * project it was written in. A vault installed under any other name gets
   * its real folder instead of a redirect into a path that does not exist. */
  const body = source.replace(/MemoValeOS\//g, `${vaultRel}/`);
  const block = `${BEGIN}\n${norm(body).trim()}\n${END}\n`;
  const target = join(PROJECT, "CLAUDE.md");
  const existing = readIfExists(target);

  if (existing === null) {
    act(cls, "create", relative(PROJECT, target), "redirect to MemoValeOS/CLAUDE.md");
    return { mode: "create", target, block };
  }
  if (norm(existing).includes(BEGIN)) {
    note(cls, relative(PROJECT, target), "redirect already present");
    return null;
  }
  /* The redirect's text, already there but unmarked — which is how every
   * hand-installed project looks, including the one this system was built in.
   * Moving that body to the Inbox would file the redirect as if it were the
   * host's own knowledge and then write it back verbatim: pure churn. Stamp
   * the markers around what is already correct instead. */
  if (norm(existing).trim() === norm(body).trim()) {
    act(cls, "mark", relative(PROJECT, target), "redirect already correct; markers added");
    return { mode: "mark", target, block };
  }
  /* The host's own CLAUDE.md, unmarked. Its body is knowledge — possibly the
   * only written record of how that project works — so it is moved whole and
   * unedited, and a human decides where each part of it belongs. */
  const inbox = join(VAULT, "Project-OS", "Inbox", "Adopted CLAUDE.md");
  if (norm(existing).trim() === "") {
    act(cls, "prepend", relative(PROJECT, target), "file is empty; redirect written");
    return { mode: "prepend", target, block, existing, inbox: null };
  }
  act(cls, "prepend", relative(PROJECT, target), "redirect added at the top");
  act(cls, "create", relative(PROJECT, inbox), "the host's previous CLAUDE.md body, verbatim");
  return { mode: "prepend", target, block, existing, inbox };
}

function applyClaudeMd(plan) {
  if (!plan) return;
  if (plan.mode === "create" || plan.mode === "mark") {
    writeFileSync(plan.target, plan.block, "utf8");
    return;
  }
  const body = norm(plan.existing);
  if (plan.inbox) {
    ensureDir(dirname(plan.inbox));
    const stamp = new Date().toISOString().slice(0, 10);
    const provenance =
      `> Moved verbatim from \`${relative(PROJECT, plan.target).split(sep).join("/")}\` ` +
      `by \`adopt.mjs\` on ${stamp}. Nothing below is edited. Distribute it into ` +
      `Project-OS deliberately, item by item; what has no home stays here.\n\n`;
    writeFileSync(plan.inbox, provenance + body.replace(/\s*$/, "") + "\n", "utf8");
  }
  writeFileSync(plan.target, plan.block + "\n" + body.replace(/^\s*/, ""), "utf8");
}

/* ------------------------------------------------------------- gitignore */

const IGNORE_BLOCK = [
  "# MemoValeOS: per-session artifacts of the reading-budget audit. The hook",
  "# and its test are source; what a given session read is not.",
  ".claude/budget-audit.jsonl",
  ".claude/budget.json",
];

function planGitignore() {
  const cls = "gitignore";
  const target = join(PROJECT, ".gitignore");
  const existing = readIfExists(target);
  const needed = IGNORE_BLOCK.filter((l) => l.startsWith("."));
  if (existing === null) {
    act(cls, "create", relative(PROJECT, target), "ignore the budget audit's per-session artifacts");
    return { target, existing: "", missing: needed };
  }
  const lines = norm(existing).split("\n").map((l) => l.trim());
  const missing = needed.filter((l) => !lines.includes(l));
  if (missing.length === 0) {
    note(cls, relative(PROJECT, target), "already ignores the budget artifacts");
    return null;
  }
  act(cls, "append", relative(PROJECT, target), `${missing.length} line(s)`);
  return { target, existing, missing };
}

function applyGitignore(plan) {
  if (!plan) return;
  const body = plan.existing ? norm(plan.existing).replace(/\s*$/, "") + "\n\n" : "";
  writeFileSync(plan.target, body + IGNORE_BLOCK.join("\n") + "\n", "utf8");
}

/* ------------------------------------------------------------------ census */

function census() {
  const rows = [];
  const claudeMd = readIfExists(join(PROJECT, "CLAUDE.md"));
  rows.push([
    "CLAUDE.md",
    claudeMd === null
      ? "absent"
      : norm(claudeMd).includes(BEGIN)
        ? `present, ${norm(claudeMd).split("\n").length} lines, redirect present`
        : `present, ${norm(claudeMd).split("\n").length} lines, no redirect`,
  ]);

  for (const sub of ["commands", "hooks", "agents"]) {
    const dir = join(CLAUDE_DIR, sub);
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      rows.push([`.claude/${sub}/`, "absent"]);
      continue;
    }
    const ours = entries.filter((n) => (sub === "commands" ? isMv(n) : n.startsWith("budget-audit")));
    const theirs = entries.length - ours.length;
    rows.push([
      `.claude/${sub}/`,
      sub === "agents"
        ? `present, ${entries.length} file(s) — never touched`
        : `present, ${entries.length} file(s) — ${ours.length} ours, ${theirs} the project's`,
    ]);
  }

  const settings = readIfExists(join(CLAUDE_DIR, "settings.json"));
  if (settings === null) rows.push([".claude/settings.json", "absent"]);
  else {
    try {
      const o = JSON.parse(settings);
      rows.push([".claude/settings.json", `present, valid JSON, ${(o.hooks?.PreToolUse ?? []).length} PreToolUse matcher(s)`]);
    } catch {
      rows.push([".claude/settings.json", "present, DOES NOT PARSE — will be left untouched"]);
    }
  }
  return rows;
}

/* -------------------------------------------------------------------- run */

const plans = {};
if (CLASSES.includes("commands")) planCopies("commands", "commands", isMv);
if (CLASSES.includes("hooks")) planHooks();
if (CLASSES.includes("settings")) plans.settings = planSettings();
if (CLASSES.includes("claude-md")) plans.claudeMd = planClaudeMd();
if (CLASSES.includes("gitignore")) plans.gitignore = planGitignore();

if (VERIFY) {
  const drift = [...actions.filter((a) => a.kind === "overwrite" || a.kind === "create"), ...refusals];
  if (JSON_OUT) {
    console.log(JSON.stringify({ project: PROJECT, vault: VAULT, drift }, null, 2));
  } else if (drift.length === 0) {
    console.log("OK — every deployable file matches its source in Knowledge-OS/Dist.");
  } else {
    console.log(`${drift.length} file(s) differ from Dist or are not deployed:\n`);
    for (const d of drift) console.log(`  ${d.path}  — ${d.detail ?? d.why}`);
  }
  process.exit(drift.length === 0 ? 0 : 1);
}

if (JSON_OUT) {
  console.log(JSON.stringify({ project: PROJECT, vault: VAULT, classes: CLASSES, actions, refusals, notes }, null, 2));
} else {
  /* `.os-version` had no reader at all until this line: it said `os-v1` while
   * CHANGELOG had reached os-v2, and nothing noticed because nothing looked.
   * Reporting it here gives the file a consumer and makes a stale value
   * visible on every deployment. */
  const osVersion = (readIfExists(join(VAULT, ".os-version")) ?? "").trim();
  console.log(`Project root : ${PROJECT}`);
  console.log(`Vault        : ${VAULT}${osVersion ? `  (${osVersion})` : ""}\n`);
  for (const [what, state] of census()) console.log(`  ${what.padEnd(22)} ${state}`);
  console.log("");

  if (actions.length === 0) {
    console.log("Nothing to change — every class in scope is already in place.");
  } else {
    console.log(`${actions.length} change(s) proposed:\n`);
    for (const a of actions) console.log(`  [${a.cls}] ${a.kind} ${a.path}  — ${a.detail}`);
  }
  if (refusals.length) {
    console.log(`\n${refusals.length} refusal(s):\n`);
    for (const r of refusals) console.log(`  [${r.cls}] ${r.path}  — ${r.why}`);
  }
  if (notes.length) {
    console.log(`\nUnchanged:\n`);
    for (const n of notes) console.log(`  [${n.cls}] ${n.path}  — ${n.detail}`);
  }
}

if (!APPLY) {
  if (!JSON_OUT) console.log(`\nThis was a plan; nothing was written. Re-run with --apply to carry it out.`);
  process.exit(0);
}

for (const a of actions) {
  if (a.cls === "commands" || a.cls === "hooks") {
    const sub = a.cls === "commands" ? "commands" : "hooks";
    const name = a.path.split(sep).pop();
    const to = join(CLAUDE_DIR, sub, name);
    ensureDir(dirname(to));
    writeFileSync(to, readFileSync(join(DIST, sub, name), "utf8"), "utf8");
  }
}
if (CLASSES.includes("settings")) applySettings(plans.settings);
if (CLASSES.includes("claude-md")) applyClaudeMd(plans.claudeMd);
if (CLASSES.includes("gitignore")) applyGitignore(plans.gitignore);

if (!JSON_OUT) {
  console.log(`\nApplied ${actions.length} change(s).`);
  if (plans.claudeMd?.inbox) {
    console.log(`\nThe host's previous CLAUDE.md is now at:`);
    console.log(`  ${relative(PROJECT, plans.claudeMd.inbox)}`);
    console.log(`Distributing it into Project-OS is a judgement call and is deliberately not done here.`);
  }
  console.log(`\nNothing was staged or committed. Next:`);
  console.log(`  node "Knowledge-OS/Tools/validate-vault.mjs"`);
}

process.exit(refusals.length ? 2 : 0);
