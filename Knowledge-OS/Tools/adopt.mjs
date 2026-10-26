#!/usr/bin/env node
/**
 * adopt.mjs — install the OS layer into the project that hosts this vault,
 * and take it out again.
 *
 * Two modes, because there are two kinds of host:
 *
 *   --team    the whole team works with the OS. Commands and the budget hook
 *             are copied into the project's `.claude/`, the hook is entered in
 *             `.claude/settings.json`, a redirect goes at the top of the
 *             project's `CLAUDE.md`, and `.gitignore` learns the budget
 *             artifacts. Everything lands in files the team shares.
 *   --local   one person works with it, in a project the team owns. Not one
 *             tracked file changes. The commands and hook come as the Claude
 *             Code plugin `mv` (Knowledge-OS/Dist/plugin/, its marketplace the
 *             vault itself), the assistant's entry point is a file of ours,
 *             `.claude/rules/memovaleos.md`, and the vault, that file and the
 *             budget artifacts are listed in `.git/info/exclude` — which git
 *             never shares. The first real installation needed exactly this
 *             and had to assemble it by hand.
 *
 * The slash commands and the budget hook have to exist under the project
 * root's `.claude/` for Claude Code to load them, and under
 * `Knowledge-OS/Dist/` for delivery to carry them — the root `.claude/` is
 * outside the vault by construction, so one canonical location cannot serve
 * both. In team mode this script turns the source into the deployed copy, and
 * `deployed-command-drift` in validate-vault.mjs keeps the two from diverging.
 *
 * It writes into a tree it does not own. Everything here follows from that:
 *
 *   - The default is a plan. Nothing is written without --apply, and the
 *     plan ends with the exact command that applies it. That command is meant
 *     for the human: `.claude/` and `.git/` are protected paths for the
 *     assistant, and a personal install also needs `claude plugin …`, which
 *     changes Claude Code's own configuration. /mv-adopt plans and hands over.
 *   - Only `mv-*` names, the hook, `.claude/rules/memovaleos.md` and blocks
 *     between our markers are ever written. Everything else in `.claude/` is
 *     the host project's; `.claude/agents/` is never touched at all.
 *   - A settings.json that does not parse is left exactly as found.
 *   - Nothing is deleted except by --uninstall, and then only what is
 *     provably ours: a file whose hash the install record holds, or one
 *     identical to its source in Dist. A file we wrote and somebody edited is
 *     refused without --yes. Nothing is ever staged or committed.
 *
 * The one thing it deliberately does not finish: when the host already had a
 * CLAUDE.md (team mode), its body stays where it is under the redirect, and a
 * verbatim copy goes to Project-OS/Inbox/, where it is left. Deciding which
 * of those instructions is a Decision, which is Architecture and which is
 * project convention is judgement, and this script has none.
 *
 * Usage:
 *   node "Knowledge-OS/Tools/adopt.mjs"                        # plan, writes nothing
 *   node "Knowledge-OS/Tools/adopt.mjs" --local                 # plan the personal install
 *   node "Knowledge-OS/Tools/adopt.mjs" --apply --local         # carry it out
 *   node "Knowledge-OS/Tools/adopt.mjs" --apply --team --only commands,hooks
 *   node "Knowledge-OS/Tools/adopt.mjs" --verify                # exit 1 if the install is incomplete or stale
 *   node "Knowledge-OS/Tools/adopt.mjs" --uninstall             # plan the removal
 *   node "Knowledge-OS/Tools/adopt.mjs" --uninstall --apply
 *   node "Knowledge-OS/Tools/adopt.mjs" --apply --yes           # overwrite or remove our files even if edited
 *   node "Knowledge-OS/Tools/adopt.mjs" --project <dir>         # target root, if not derivable
 *   node "Knowledge-OS/Tools/adopt.mjs" --standalone            # the vault is the project itself
 *   node "Knowledge-OS/Tools/adopt.mjs" --language ru --notes split   # the project's language, in mvos.config.json
 *   node "Knowledge-OS/Tools/adopt.mjs" --json
 *
 * The mode is the flag; else the install record's; else `team` if a team
 * install is already in place. With none of those the plan shows the
 * recommended mode and --apply refuses until one is named.
 *
 * Every apply records what it installed in the vault, at `.mvos/install.json`:
 * the project root, the mode, and each file and block of ours with its hash.
 * The record is what later runs — and the validator, stale-check, an
 * uninstall — take the project root from, instead of guessing it from git.
 *
 * Exit codes: 0 nothing to do or done; 1 a precondition failed, or --verify
 * found the install incomplete or stale; 2 applied, but a step refused
 * (unparseable settings.json, or a file of ours edited and --yes absent).
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

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
const STANDALONE = flag("--standalone");
const UNINSTALL = flag("--uninstall");
const LANGUAGE = value("--language");
const NOTES = value("--notes");

/* Same shapes as invalid-config in validate-vault.mjs. */
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const NOTES_POLICIES = ["language", "english", "split"];
if (LANGUAGE !== null && !LANGUAGE_TAG.test(LANGUAGE)) {
  console.error(`--language takes a language tag such as ru, en, de or pt-BR; got \`${LANGUAGE}\`.`);
  process.exit(1);
}
if (NOTES !== null && !NOTES_POLICIES.includes(NOTES)) {
  console.error(`--notes takes ${NOTES_POLICIES.join(", ")}; got \`${NOTES}\`.`);
  process.exit(1);
}

const TEAM_CLASSES = ["commands", "hooks", "settings", "claude-md", "gitignore"];
const LOCAL_CLASSES = ["plugin", "rules", "exclude"];

if (flag("--team") && flag("--local")) {
  console.error("Choose one mode: --team or --local.");
  process.exit(1);
}
if (UNINSTALL && VERIFY) {
  console.error("--uninstall and --verify do not go together.");
  process.exit(1);
}

/* ---------------------------------------------------------------- helpers */

const actions = []; // {cls, kind, path, detail}
const refusals = []; // {cls, path, why}
const notes = []; // informational, no action
const ownerSteps = []; // commands only the human runs

const act = (cls, kind, path, detail) => actions.push({ cls, kind, path, detail });
const refuse = (cls, path, why) => refusals.push({ cls, path, why });
const note = (cls, path, detail) => notes.push({ cls, path, detail });

const norm = (s) => s.replace(/\r\n/g, "\n");
const isMv = (n) => /^mv-[^/\\]+\.md$/.test(n);
/* LF-normalised, so a checkout with autocrlf does not read as a local edit. */
const sha256 = (s) => createHash("sha256").update(norm(s)).digest("hex");

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

/* Windows paths compare without case: git reports `G:/…` where the vault's
 * own path may say `g:\…`. */
const samePath = (a, b) => (process.platform === "win32" ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b));

function gitToplevel(cwd) {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    return top ? resolve(top.split("/").join(sep)) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ roots */

/* The install record: what the last apply put where. Never delivered and not
 * a per-copy file either: it describes one installation (os-manifest says
 * why). A record that does not parse is treated as absent, and the plan says
 * so. */
const RECORD_PATH = join(VAULT, ".mvos", "install.json");

function readRecord() {
  const raw = readIfExists(RECORD_PATH);
  if (raw === null) return null;
  try {
    const r = JSON.parse(raw);
    return r && typeof r === "object" && typeof r.projectRoot === "string" ? r : { unreadable: true };
  } catch {
    return { unreadable: true };
  }
}

const RECORD = readRecord();
const RECORD_OK = RECORD && !RECORD.unreadable;

/* Which root to deploy into, in this order: what the human said (--project,
 * --standalone); what the last apply recorded; the git toplevel holding the
 * vault; the vault's parent, for trees that are not repositories at all
 * (fixtures, throwaway checkouts).
 *
 * One case is refused rather than guessed. A vault that is its own git
 * toplevel while its parent sits in another repository is a clone of the
 * distribution inside a project — the first real installation looked exactly
 * like that, and the toplevel rule deployed `.claude/` into the vault itself,
 * where Claude Code never looks. Both readings are legitimate (an embedded
 * install, or a standalone vault that happens to live inside a checkout), so
 * the human names one. */
function detectProjectRoot() {
  const explicit = value("--project");
  if (explicit) return { root: resolve(explicit), how: "--project" };
  if (STANDALONE) return { root: VAULT, how: "--standalone" };
  if (RECORD_OK) return { root: resolve(VAULT, RECORD.projectRoot), how: "install record" };
  const top = gitToplevel(VAULT);
  if (top && samePath(top, VAULT)) {
    const outer = gitToplevel(dirname(VAULT));
    if (outer) {
      return {
        refuse:
          `The vault is a git repository of its own, inside another one:\n` +
          `  vault        : ${VAULT}\n` +
          `  outer repo   : ${outer}\n` +
          `Say which root to deploy into:\n` +
          `  --project "${outer}"   the vault is installed into that project (the usual case)\n` +
          `  --standalone           the vault is the project itself`,
      };
    }
  }
  if (top) return { root: top, how: "git toplevel" };
  return { root: dirname(VAULT), how: "the vault's parent (no git repository)" };
}

const ROOT = detectProjectRoot();
if (ROOT.refuse) {
  console.error(ROOT.refuse);
  process.exit(1);
}
const PROJECT = ROOT.root;

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
const VAULT_REL = relative(PROJECT, VAULT).split(sep).join("/");
const posixFromProject = (p) => relative(PROJECT, p).split(sep).join("/");
const IS_STANDALONE = samePath(PROJECT, VAULT);
const PROJECT_IS_GIT = gitToplevel(PROJECT) !== null;

function gitTracked(rel) {
  try {
    execFileSync("git", ["ls-files", "--error-unmatch", "--", rel], { cwd: PROJECT, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------- mode */

const BEGIN = "<!-- MemoValeOS:redirect:begin -->";
const END = "<!-- MemoValeOS:redirect:end -->";

function teamInstallPresent() {
  try {
    if (readdirSync(join(CLAUDE_DIR, "commands")).some(isMv)) return true;
  } catch {
    /* no commands folder */
  }
  const claude = readIfExists(join(PROJECT, "CLAUDE.md"));
  return claude !== null && norm(claude).includes(BEGIN);
}

/* What to suggest when nothing names a mode. In a git repository the personal
 * install is the safe default — it changes no file anyone else clones — and
 * a tracked CLAUDE.md is the clearest sign the project is shared. Without
 * git there is nothing to share, and the team install is simply the plain
 * one. */
function recommendMode() {
  if (IS_STANDALONE) return { mode: "standalone", why: "the vault is the project" };
  if (PROJECT_IS_GIT && gitTracked("CLAUDE.md")) {
    return { mode: "local", why: "CLAUDE.md is tracked by git: it belongs to everyone who clones the project, and a personal install leaves it alone" };
  }
  if (PROJECT_IS_GIT) return { mode: "local", why: "the project is a git repository, and a personal install changes nothing anyone else clones; choose --team when the whole team adopts the OS" };
  return { mode: "team", why: "the project is not a git repository, so there is nothing shared to keep apart" };
}

function resolveMode() {
  if (flag("--local")) return { mode: "local", how: "--local" };
  if (flag("--team")) return { mode: IS_STANDALONE ? "standalone" : "team", how: "--team" };
  if (IS_STANDALONE) return { mode: "standalone", how: "the vault is the project" };
  if (RECORD_OK && RECORD.mode) return { mode: RECORD.mode, how: "install record" };
  if (teamInstallPresent()) return { mode: "team", how: "a team install is already in place" };
  /* The personal install keeps itself out of git with .git/info/exclude; a
   * project that is no repository leaves only one mode to mean. */
  if (!PROJECT_IS_GIT) return { mode: "team", how: "the project is not a git repository, so the personal install has nothing to keep apart" };
  return { mode: null, how: "not chosen" };
}

const CHOSEN = resolveMode();
const RECOMMENDED = CHOSEN.mode ? null : recommendMode();
/* Without a chosen mode the plan is drawn for the recommended one, so the
 * human sees what they would be agreeing to; applying it still needs a flag. */
const MODE = CHOSEN.mode ?? RECOMMENDED.mode;

if (MODE === "local" && IS_STANDALONE) {
  console.error("A standalone vault is the project itself; there is no host to keep untouched. Use --team, or install into a project with --project <dir>.");
  process.exit(1);
}

const MODE_CLASSES = MODE === "local" ? LOCAL_CLASSES : TEAM_CLASSES;
const only = value("--only");
const CLASSES = only ? only.split(",").map((c) => c.trim()).filter(Boolean) : MODE_CLASSES;
for (const c of CLASSES) {
  if (!MODE_CLASSES.includes(c)) {
    console.error(`Unknown class \`${c}\` for mode ${MODE}. Known: ${MODE_CLASSES.join(", ")}`);
    process.exit(1);
  }
}

/* The record states what is ours, by hash; Dist states what ours looks like
 * now. A deployed file matching either is provably ours to replace or
 * remove. */
const recordedHash = (projectRel) => (RECORD_OK ? (RECORD.files ?? []).find((f) => f.path === projectRel)?.sha256 : undefined);
function provablyOurs(path, distSource) {
  const have = readIfExists(path);
  if (have === null) return false;
  if (recordedHash(posixFromProject(path)) === sha256(have)) return true;
  return distSource !== null && distSource !== undefined && norm(have) === norm(distSource);
}

/* ------------------------------------------------------ team: file copies */

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
const isHookSource = (n) => /\.(mjs|cjs)$/.test(n) && !/\.test\.mjs$/.test(n);
const isOurHookFile = (n) => /^budget-audit\.(cjs|mjs)$/.test(n);

/* Names the hook has had, newest last. The ESM `budget-audit.mjs` did not
 * parse on a host's Node 12 and was replaced by `budget-audit.cjs` on
 * 2026-10-25. An install leaves a deployed copy of an older name in place and
 * says what it is; --uninstall removes it like any file of ours. */
const OLD_HOOK_NAMES = ["budget-audit.mjs"];

function planHooks() {
  planCopies("hooks", "hooks", isHookSource);
  for (const old of OLD_HOOK_NAMES) {
    const deployed = join(CLAUDE_DIR, "hooks", old);
    if (existsSync(deployed) && !existsSync(join(DIST, "hooks", old))) {
      note("hooks", relative(PROJECT, deployed), "an older version of the hook; once settings no longer name it, delete it by hand");
    }
  }
}

/* ------------------------------------------------------- team: settings */

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

const isOurHook = (h) => JSON.stringify(h ?? null).includes("budget-audit.");

function ourHookEntries(settings) {
  const out = [];
  for (const m of settings?.hooks?.PreToolUse ?? []) for (const h of m?.hooks ?? []) if (isOurHook(h)) out.push(h);
  return out;
}

const sameHook = (a, b) =>
  a?.type === b?.type &&
  a?.command === b?.command &&
  JSON.stringify(a?.args ?? []) === JSON.stringify(b?.args ?? []) &&
  a?.timeout === b?.timeout;

function readSettings(cls, target) {
  const raw = readIfExists(target);
  if (raw === null) return { raw: null };
  try {
    return { raw, parsed: JSON.parse(raw) };
  } catch (e) {
    /* Refuse, loudly, and change nothing. Rewriting a file that could not be
     * read is the single most destructive thing the script could do. */
    refuse(cls, relative(PROJECT, target), `not valid JSON (${e.message.split("\n")[0]}); left untouched`);
    return { unreadable: true };
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

  const s = readSettings(cls, target);
  if (s.unreadable) return null;
  if (s.raw === null) {
    act(cls, "create", relative(PROJECT, target), "hook block from the fragment");
    return { mode: "create", frag, target };
  }
  const parsed = s.parsed;

  /* Our entry is recognised by the hook's name, under any extension or form:
   * the shell-form `node ".../budget-audit.mjs"` that settings carried until
   * 2026-10-25 is ours as much as the exec-form `.cjs` entry that replaces it.
   * Recognising only the current form would append a second hook beside the
   * old one, and the old one would go on failing on every read. */
  const ours = ourHookEntries(parsed);
  if (ours.length === 1 && sameHook(ours[0], frag.hooks[0])) {
    note(cls, relative(PROJECT, target), "the budget hook entry is already current");
    return null;
  }
  if (ours.length > 0) {
    act(
      cls,
      "replace",
      relative(PROJECT, target),
      `replace ${ours.length} older budget hook entr${ours.length === 1 ? "y" : "ies"} with the current one (exec form, budget-audit.cjs)`
    );
    return { mode: "replace", frag, target, parsed };
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

/* Our entries out, everything of the host's in place; a matcher left with no
 * hooks goes, and so do PreToolUse and hooks once empty. */
function withoutOurHooks(obj, replacement = null) {
  let placed = false;
  obj.hooks.PreToolUse = obj.hooks.PreToolUse.map((m) => {
    if (!Array.isArray(m?.hooks)) return m;
    const hooks = [];
    for (const h of m.hooks) {
      if (!isOurHook(h)) hooks.push(h);
      else if (replacement && !placed) {
        hooks.push(replacement);
        placed = true;
      }
    }
    return { ...m, hooks };
  }).filter((m) => !Array.isArray(m?.hooks) || m.hooks.length > 0);
  if (obj.hooks.PreToolUse.length === 0) delete obj.hooks.PreToolUse;
  if (Object.keys(obj.hooks).length === 0) delete obj.hooks;
  return obj;
}

function applySettings(plan) {
  if (!plan) return;
  if (plan.mode === "create") {
    ensureDir(dirname(plan.target));
    writeFileSync(plan.target, JSON.stringify({ hooks: { PreToolUse: [plan.frag] } }, null, 2) + "\n", "utf8");
    return;
  }
  if (plan.mode === "replace") {
    /* The first of our entries becomes the current one, in place, so its
     * position among the host's own hooks is kept; any further copies go. */
    writeFileSync(plan.target, JSON.stringify(withoutOurHooks(plan.parsed, plan.frag.hooks[0]), null, 2) + "\n", "utf8");
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

/* ------------------------------------------------------ team: CLAUDE.md */

function redirectBody() {
  const source = readIfExists(join(DIST, "CLAUDE.redirect.md"));
  /* The source names the vault folder as `MemoValeOS/`, the name it has in the
   * project it was written in. A vault installed under any other name gets
   * its real folder instead of a redirect into a path that does not exist. */
  return source === null ? null : norm(source).replace(/MemoValeOS\//g, `${VAULT_REL}/`).trim();
}

function planClaudeMd() {
  const cls = "claude-md";
  /* Standalone layout: the project root IS the vault, and its CLAUDE.md is the
   * real entry point, not a host file. A redirect there would point at itself
   * and file the actual entry point into the Inbox as if it were foreign. */
  if (VAULT_REL === "") {
    note(cls, "CLAUDE.md", "standalone layout: the vault's own CLAUDE.md is the entry point; no redirect");
    return null;
  }
  const body = redirectBody();
  if (body === null) {
    refuse(cls, relative(VAULT, join(DIST, "CLAUDE.redirect.md")), "redirect source missing");
    return null;
  }
  const block = `${BEGIN}\n${body}\n${END}\n`;
  const target = join(PROJECT, "CLAUDE.md");
  const existing = readIfExists(target);

  if (existing === null) {
    act(cls, "create", relative(PROJECT, target), `redirect to ${VAULT_REL}/CLAUDE.md`);
    return { mode: "create", target, block };
  }
  if (norm(existing).includes(BEGIN)) {
    note(cls, relative(PROJECT, target), "redirect already present");
    return null;
  }
  /* The redirect's text, already there but unmarked — which is how every
   * hand-installed project looks, including the one this system was built in.
   * Copying that body to the Inbox would file the redirect as if it were the
   * host's own knowledge: pure churn. Stamp the markers around what is
   * already correct instead. */
  if (norm(existing).trim() === body) {
    act(cls, "mark", relative(PROJECT, target), "redirect already correct; markers added");
    return { mode: "mark", target, block };
  }
  /* The host's own CLAUDE.md, unmarked. Its body is knowledge — possibly the
   * only written record of how that project works — so it stays in place,
   * whole and unedited, and a verbatim copy goes to the Inbox for a human to
   * distribute. */
  const inbox = join(VAULT, "Project-OS", "Inbox", "Adopted CLAUDE.md");
  if (norm(existing).trim() === "") {
    act(cls, "prepend", relative(PROJECT, target), "file is empty; redirect written");
    return { mode: "prepend", target, block, existing, inbox: null };
  }
  act(cls, "prepend", relative(PROJECT, target), "redirect added at the top");
  act(cls, "create", relative(PROJECT, inbox), "a verbatim copy of the host's CLAUDE.md body");
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
      `> Copied verbatim from \`${relative(PROJECT, plan.target).split(sep).join("/")}\` ` +
      `by \`adopt.mjs\` on ${stamp}; the original stays in place under the redirect. Nothing below is edited. Distribute it into ` +
      `Project-OS deliberately, item by item; what has no home stays here.\n\n`;
    writeFileSync(plan.inbox, provenance + body.replace(/\s*$/, "") + "\n", "utf8");
  }
  writeFileSync(plan.target, plan.block + "\n" + body.replace(/^\s*/, ""), "utf8");
}

/* ------------------------------------------------------ team: gitignore */

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

/* ----------------------------------------------- local: rules, exclude, plugin */

/* The assistant's entry point in a personal install. Not CLAUDE.local.md: its
 * presence stops Claude Code reading AGENTS.md, and a user may already keep
 * one. A file of our own under `.claude/rules/` loads the same way, hides
 * nothing, and is removed by deleting it. */
const RULES_PATH = join(CLAUDE_DIR, "rules", "memovaleos.md");

function rulesText() {
  const body = redirectBody();
  if (body === null) return null;
  return `<!-- MemoValeOS, personal install (adopt.mjs --local). Removed by adopt.mjs --uninstall. -->\n\n${body}\n`;
}

function planRules() {
  const cls = "rules";
  const want = rulesText();
  if (want === null) {
    refuse(cls, relative(VAULT, join(DIST, "CLAUDE.redirect.md")), "redirect source missing");
    return;
  }
  const have = readIfExists(RULES_PATH);
  const where = posixFromProject(RULES_PATH);
  if (have === null) act(cls, "create", where, `the assistant's entry point: read ${VAULT_REL}/CLAUDE.md first`);
  else if (norm(have) === want) note(cls, where, "already current");
  else if (YES || provablyOurs(RULES_PATH, null)) act(cls, "overwrite", where, "brought up to date");
  else refuse(cls, where, "differs from what this install writes; pass --yes to overwrite");
}

function applyRules() {
  ensureDir(dirname(RULES_PATH));
  writeFileSync(RULES_PATH, rulesText(), "utf8");
}

/* `.git/info/exclude` is git's own ignore file that is never committed or
 * shared — what a personal install needs instead of `.gitignore`, which the
 * team owns. `--git-path` finds it in a worktree too, where `.git` is a file. */
const EXCLUDE_BEGIN = "# >>> MemoValeOS personal install (adopt.mjs --local)";
const EXCLUDE_END = "# <<< MemoValeOS";

function excludeFile() {
  try {
    const p = execFileSync("git", ["rev-parse", "--git-path", "info/exclude"], { cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    return p ? resolve(PROJECT, p) : null;
  } catch {
    return null;
  }
}

function excludeBlock() {
  return [
    EXCLUDE_BEGIN,
    `/${VAULT_REL}/`,
    "/.claude/rules/memovaleos.md",
    "/.claude/budget.json",
    "/.claude/budget-audit.jsonl",
    "/.claude/settings.local.json",
    EXCLUDE_END,
  ].join("\n");
}

function blockIn(text, begin, end) {
  const t = norm(text);
  const i = t.indexOf(begin);
  if (i === -1) return null;
  const j = t.indexOf(end, i);
  return j === -1 ? null : { start: i, stop: j + end.length, text: t.slice(i, j + end.length) };
}

/* Remove a block and the one newline that ends it, nothing else, so text
 * around it comes back byte for byte. */
function withoutBlock(text, begin, end) {
  const t = norm(text);
  const b = blockIn(t, begin, end);
  if (!b) return t;
  let after = b.stop;
  if (t[after] === "\n") after++;
  let before = b.start;
  if (before > 0 && t[before - 1] === "\n" && t[before - 2] === "\n") before--;
  return t.slice(0, before) + t.slice(after);
}

function planExclude() {
  const cls = "exclude";
  const file = excludeFile();
  if (!file) {
    note(cls, "—", "the project is not a git repository; there is nothing to exclude from");
    return null;
  }
  const where = posixFromProject(file);
  try {
    const tracked = execFileSync("git", ["ls-files", "--", VAULT_REL], { cwd: PROJECT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (tracked) note(cls, VAULT_REL, "the vault is already tracked by git, and an exclude does not untrack it; `git rm -r --cached` is a decision for the team");
  } catch {
    /* not answerable; carry on */
  }
  const have = readIfExists(file) ?? "";
  const current = blockIn(have, EXCLUDE_BEGIN, EXCLUDE_END);
  if (!current) {
    act(cls, "append", where, `keep the vault, the rules file and the budget artifacts out of git, for this clone only`);
    return { file, have };
  }
  if (current.text === excludeBlock()) {
    note(cls, where, "already excludes what this install adds");
    return null;
  }
  act(cls, "update", where, "the block is replaced with the current one");
  return { file, have };
}

function applyExclude(plan) {
  if (!plan) return;
  const rest = withoutBlock(plan.have, EXCLUDE_BEGIN, EXCLUDE_END).replace(/\s*$/, "");
  ensureDir(dirname(plan.file));
  writeFileSync(plan.file, (rest ? rest + "\n\n" : "") + excludeBlock() + "\n", "utf8");
}

/* The plugin is installed by Claude Code itself, and its commands change
 * Claude Code's own configuration — the human runs them. Whether it is
 * already there is read from the project's settings.local.json, where a
 * local-scope install records it. */
const PLUGIN_ID = "mv@memovaleos";
const MARKETPLACE = "memovaleos";

function pluginEnabled() {
  try {
    const s = JSON.parse(readFileSync(join(CLAUDE_DIR, "settings.local.json"), "utf8"));
    return s?.enabledPlugins?.[PLUGIN_ID] === true;
  } catch {
    return false;
  }
}

function planPlugin() {
  const cls = "plugin";
  const where = ".claude/settings.local.json";
  if (!existsSync(join(VAULT, ".claude-plugin", "marketplace.json"))) {
    refuse(cls, `${VAULT_REL}/.claude-plugin/marketplace.json`, "the vault carries no plugin marketplace; rebuild it with build-plugin.mjs");
    return;
  }
  if (pluginEnabled()) {
    note(cls, where, `${PLUGIN_ID} is enabled for this project`);
  } else {
    act(cls, "owner", where, `install the plugin ${PLUGIN_ID} — Claude Code's own command, for you to run (below)`);
    ownerSteps.push(`claude plugin marketplace add "${VAULT}" --scope local`, `claude plugin install ${PLUGIN_ID} --scope local`);
  }
  /* A team install already here would load every command twice — /mv-check
   * from .claude/commands and /mv:check from the plugin. */
  try {
    const copies = readdirSync(join(CLAUDE_DIR, "commands")).filter(isMv).length;
    if (copies) note(cls, ".claude/commands", `${copies} mv-* cop${copies === 1 ? "y" : "ies"} from a team install would load beside the plugin; once it works, remove them with \`adopt.mjs --uninstall --team\``);
  } catch {
    /* none */
  }
  const local = readIfExists(join(PROJECT, "CLAUDE.local.md"));
  if (local !== null && norm(local).includes(`${VAULT_REL}/CLAUDE.md`)) {
    note(cls, "CLAUDE.local.md", `also points at ${VAULT_REL}/CLAUDE.md; the rules file does that now — remove those lines by hand`);
  }
}

/* -------------------------------------------------------------- uninstall */

/* What is ours, taken out in the order that cannot strand the host: the hook
 * entry before the hook file (a hook named in settings with no file behind it
 * fails on every read), the plugin before its marketplace, the record last. */
function planUninstallFiles(cls, dir, matches, distDir) {
  let names;
  try {
    names = readdirSync(dir).filter(matches).sort();
  } catch {
    return;
  }
  for (const n of names) {
    const p = join(dir, n);
    const dist = distDir ? readIfExists(join(distDir, n)) : null;
    if (provablyOurs(p, dist) || YES) act(cls, "delete", posixFromProject(p), YES && !provablyOurs(p, dist) ? "edited since install, removed (--yes)" : "ours, unchanged");
    else refuse(cls, posixFromProject(p), "edited since it was installed; pass --yes to remove it anyway");
  }
}

const uninstall = { settings: null, claudeMd: null, gitignore: null, exclude: null };

function planUninstall() {
  if (MODE === "local") {
    if (CLASSES.includes("plugin") && pluginEnabled()) {
      act("plugin", "owner", ".claude/settings.local.json", `uninstall ${PLUGIN_ID} — Claude Code's own command, for you to run (below)`);
      ownerSteps.push(`claude plugin uninstall ${PLUGIN_ID} --scope local`, `claude plugin marketplace remove ${MARKETPLACE}`);
    }
    if (CLASSES.includes("rules") && existsSync(RULES_PATH)) {
      const ours = norm(readIfExists(RULES_PATH)) === rulesText() || provablyOurs(RULES_PATH, null);
      if (ours || YES) act("rules", "delete", posixFromProject(RULES_PATH), ours ? "ours, unchanged" : "edited since install, removed (--yes)");
      else refuse("rules", posixFromProject(RULES_PATH), "edited since it was installed; pass --yes to remove it anyway");
    }
    if (CLASSES.includes("exclude")) {
      const file = excludeFile();
      const have = file ? readIfExists(file) : null;
      if (have !== null && blockIn(have, EXCLUDE_BEGIN, EXCLUDE_END)) {
        act("exclude", "remove-block", posixFromProject(file), "our block out; the rest of the file as it was");
        uninstall.exclude = { file, have };
      }
    }
  } else {
    if (CLASSES.includes("settings")) {
      const target = join(CLAUDE_DIR, "settings.json");
      const s = readSettings("settings", target);
      if (s.parsed && ourHookEntries(s.parsed).length) {
        act("settings", "remove-entry", posixFromProject(target), "the budget hook entry out, the project's hooks in place");
        uninstall.settings = { target, parsed: s.parsed };
      }
    }
    if (CLASSES.includes("hooks")) planUninstallFiles("hooks", join(CLAUDE_DIR, "hooks"), isOurHookFile, join(DIST, "hooks"));
    if (CLASSES.includes("commands")) planUninstallFiles("commands", join(CLAUDE_DIR, "commands"), isMv, join(DIST, "commands"));
    if (CLASSES.includes("claude-md")) {
      const target = join(PROJECT, "CLAUDE.md");
      const have = readIfExists(target);
      const block = have === null ? null : blockIn(have, BEGIN, END);
      if (block) {
        /* An install put the redirect at the top and one blank line under it;
         * both go, so the project's text comes back as it was. */
        let rest = withoutBlock(have, BEGIN, END);
        if (block.start === 0) rest = rest.replace(/^\n/, "");
        act("claude-md", rest.trim() === "" ? "delete" : "remove-block", "CLAUDE.md", rest.trim() === "" ? "nothing but our redirect; the file goes" : "the redirect out, the project's text as it was");
        uninstall.claudeMd = { target, rest };
      }
    }
    if (CLASSES.includes("gitignore")) {
      const target = join(PROJECT, ".gitignore");
      const have = readIfExists(target);
      if (have !== null && norm(have).includes(IGNORE_BLOCK.join("\n"))) {
        act("gitignore", "remove-block", ".gitignore", "the budget-artifact lines out");
        uninstall.gitignore = { target, have };
      }
    }
  }
  if (existsSync(RECORD_PATH)) act("record", "delete", posixFromProject(RECORD_PATH), "the install record goes last");
  note("vault", VAULT_REL || ".", "the vault itself is never removed; delete it yourself if you mean to");
}

function applyUninstall() {
  const del = (rel) => rmSync(join(PROJECT, ...rel.split("/")), { force: true });
  if (uninstall.settings) {
    const obj = withoutOurHooks(uninstall.settings.parsed);
    if (Object.keys(obj).length === 0) rmSync(uninstall.settings.target, { force: true });
    else writeFileSync(uninstall.settings.target, JSON.stringify(obj, null, 2) + "\n", "utf8");
  }
  for (const cls of ["hooks", "commands", "rules"]) for (const a of actions) if (a.cls === cls && a.kind === "delete") del(a.path);
  if (uninstall.claudeMd) {
    if (uninstall.claudeMd.rest.trim() === "") rmSync(uninstall.claudeMd.target, { force: true });
    else writeFileSync(uninstall.claudeMd.target, uninstall.claudeMd.rest, "utf8");
  }
  if (uninstall.gitignore) {
    const t = norm(uninstall.gitignore.have);
    const blk = IGNORE_BLOCK.join("\n") + "\n";
    const i = t.indexOf(blk);
    let before = i;
    if (before > 1 && t[before - 1] === "\n" && t[before - 2] === "\n") before--;
    const rest = t.slice(0, before) + t.slice(i + blk.length);
    if (rest.trim() === "") rmSync(uninstall.gitignore.target, { force: true });
    else writeFileSync(uninstall.gitignore.target, rest, "utf8");
  }
  if (uninstall.exclude) writeFileSync(uninstall.exclude.file, withoutBlock(uninstall.exclude.have, EXCLUDE_BEGIN, EXCLUDE_END), "utf8");
  rmSync(RECORD_PATH, { force: true });
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

  /* Preflight facts: what decides how this project should be installed,
   * stated before anything is proposed. A tracked CLAUDE.md is the case that
   * cost the first real installation most: it belongs to the team, and a
   * personal install must not rewrite it. */
  rows.push(["project root from", ROOT.how]);
  rows.push([
    "install record",
    !RECORD
      ? "absent"
      : RECORD.unreadable
        ? "present, DOES NOT PARSE — will be replaced"
        : `mode ${RECORD.mode}, ${(RECORD.files ?? []).length} file(s), since ${RECORD.installedAt}`,
  ]);
  rows.push(["vault's own .git", existsSync(join(VAULT, ".git")) ? "yes" : "no"]);
  rows.push(["CLAUDE.md in git", claudeMd === null ? "—" : gitTracked("CLAUDE.md") ? "tracked: shared with everyone who clones the project" : "not tracked"]);
  for (const f of ["CLAUDE.local.md", "AGENTS.md", ".claude/settings.local.json"]) {
    if (existsSync(join(PROJECT, ...f.split("/")))) rows.push([f, gitTracked(f) ? "present, tracked" : "present"]);
  }
  for (const sub of ["skills", "rules"]) {
    try {
      const n = readdirSync(join(CLAUDE_DIR, sub)).length;
      if (n) rows.push([`.claude/${sub}/`, `present, ${n} entr${n === 1 ? "y" : "ies"}`]);
    } catch {
      /* absent */
    }
  }
  if (MODE === "local") rows.push([`plugin ${PLUGIN_ID}`, pluginEnabled() ? "enabled for this project" : "not installed"]);
  return rows;
}

/* ---------------------------------------------------------------- record */

/* Everything of ours that is on disk now, whatever the mode: files with their
 * hashes, and blocks inside files the project owns. */
function currentDeployment() {
  const files = [];
  for (const [cls, sub, matches] of [
    ["commands", "commands", isMv],
    ["hooks", "hooks", isOurHookFile],
  ]) {
    let names;
    try {
      names = readdirSync(join(CLAUDE_DIR, sub)).filter(matches).sort();
    } catch {
      continue;
    }
    for (const n of names) {
      const p = join(CLAUDE_DIR, sub, n);
      files.push({ path: posixFromProject(p), class: cls, sha256: sha256(readFileSync(p, "utf8")) });
    }
  }
  const rules = readIfExists(RULES_PATH);
  if (rules !== null) files.push({ path: posixFromProject(RULES_PATH), class: "rules", sha256: sha256(rules) });

  const blocks = [];
  const claude = readIfExists(join(PROJECT, "CLAUDE.md"));
  if (claude !== null && norm(claude).includes(BEGIN)) blocks.push({ path: "CLAUDE.md", class: "claude-md", marker: BEGIN });
  try {
    const s = readIfExists(join(CLAUDE_DIR, "settings.json"));
    if (s !== null && ourHookEntries(JSON.parse(s)).length) {
      blocks.push({ path: posixFromProject(join(CLAUDE_DIR, "settings.json")), class: "settings", entry: "budget-audit" });
    }
  } catch {
    /* an unparseable settings.json holds nothing of ours we can name */
  }
  const gi = readIfExists(join(PROJECT, ".gitignore"));
  if (gi !== null && norm(gi).includes(IGNORE_BLOCK[0])) blocks.push({ path: ".gitignore", class: "gitignore", marker: IGNORE_BLOCK[0] });
  const ex = excludeFile();
  const exText = ex ? readIfExists(ex) : null;
  if (exText !== null && blockIn(exText, EXCLUDE_BEGIN, EXCLUDE_END)) blocks.push({ path: posixFromProject(ex), class: "exclude", marker: EXCLUDE_BEGIN });
  if (pluginEnabled()) blocks.push({ path: ".claude/settings.local.json", class: "plugin", plugin: PLUGIN_ID });
  return { files, blocks };
}

const osVersion = (readIfExists(join(VAULT, ".os-version")) ?? "").trim() || null;

function recordText() {
  const { files, blocks } = currentDeployment();
  const record = {
    format: 1,
    osVersion,
    mode: MODE,
    projectRoot: relative(VAULT, PROJECT).split(sep).join("/") || ".",
    installedAt: (RECORD_OK && RECORD.installedAt) || new Date().toISOString().slice(0, 10),
    files,
    blocks,
  };
  return JSON.stringify(record, null, 2) + "\n";
}

function planRecord() {
  const where = posixFromProject(RECORD_PATH);
  const projectRoot = relative(VAULT, PROJECT).split(sep).join("/") || ".";
  if (!RECORD) act("record", "create", where, `project root \`${projectRoot}\`, mode ${MODE}, each file of ours with its hash`);
  else if (RECORD.unreadable) act("record", "overwrite", where, "the record does not parse; written afresh");
  else if (RECORD.projectRoot !== projectRoot || RECORD.mode !== MODE) {
    act("record", "update", where, `project root \`${RECORD.projectRoot}\` → \`${projectRoot}\`, mode ${RECORD.mode} → ${MODE}`);
  } else if (RECORD.osVersion !== osVersion) {
    /* The vault was upgraded since the last apply: the record still names the
     * version installed then. */
    act("record", "update", where, `OS version ${RECORD.osVersion ?? "none"} → ${osVersion ?? "none"}`);
  } else note("record", where, "current; file hashes are refreshed on apply");
}

/* ---------------------------------------------------------------- config */

/* mvos.config.json: the project's language, which the Communication Rules
 * read, and the language of its notes. In the vault, so writing it touches
 * nothing of the host's. Asked for, not guessed: without it the assistant
 * answers in the language the owner writes in, which is a fine default and
 * says nothing false. */
const CONFIG_PATH = join(VAULT, "mvos.config.json");

function planConfig() {
  const where = posixFromProject(CONFIG_PATH);
  const raw = readIfExists(CONFIG_PATH);
  let have = null;
  if (raw !== null) {
    try {
      have = JSON.parse(raw);
    } catch {
      if (LANGUAGE || NOTES) {
        refuse("config", where, "does not parse; fix or remove it by hand, then set the language");
        return null;
      }
      note("config", where, "does not parse — the validator reports invalid-config");
      return null;
    }
  }
  if (!LANGUAGE && !NOTES) {
    note("config", where, have?.language ? `language ${have.language}${have.notes ? `, notes ${have.notes}` : ""}` : "no project language: the assistant answers in the language you write in; set one with --language <tag>");
    return null;
  }
  const want = { format: 1, ...(have ?? {}), ...(LANGUAGE ? { language: LANGUAGE } : {}), ...(NOTES ? { notes: NOTES } : {}) };
  const text = JSON.stringify(want, null, 2) + "\n";
  if (raw !== null && norm(raw) === text) {
    note("config", where, "already says so");
    return null;
  }
  act("config", raw === null ? "create" : "update", where, `language ${want.language ?? "—"}${want.notes ? `, notes ${want.notes}` : ""}`);
  return text;
}

/* -------------------------------------------------------------------- run */

const plans = {};
if (UNINSTALL) {
  planUninstall();
} else if (MODE === "local") {
  if (CLASSES.includes("plugin")) planPlugin();
  if (CLASSES.includes("rules")) planRules();
  if (CLASSES.includes("exclude")) plans.exclude = planExclude();
} else {
  if (CLASSES.includes("commands")) planCopies("commands", "commands", isMv);
  if (CLASSES.includes("hooks")) planHooks();
  if (CLASSES.includes("settings")) plans.settings = planSettings();
  if (CLASSES.includes("claude-md")) plans.claudeMd = planClaudeMd();
  if (CLASSES.includes("gitignore")) plans.gitignore = planGitignore();
}
if (!VERIFY && !UNINSTALL) plans.config = planConfig();
if (!VERIFY && !UNINSTALL) planRecord();

/* The command that carries this plan out, as the human would type it. */
function applyCommand() {
  const parts = [`node "${join(VAULT, "Knowledge-OS", "Tools", "mv.cjs")}" adopt --apply`];
  if (UNINSTALL) parts.push("--uninstall");
  parts.push(MODE === "local" ? "--local" : "--team");
  if (value("--project")) parts.push(`--project "${PROJECT}"`);
  if (STANDALONE) parts.push("--standalone");
  if (only) parts.push(`--only ${CLASSES.join(",")}`);
  if (LANGUAGE) parts.push(`--language ${LANGUAGE}`);
  if (NOTES) parts.push(`--notes ${NOTES}`);
  if (YES) parts.push("--yes");
  return parts.join(" ");
}

function printOwnerSteps(lead) {
  if (!ownerSteps.length) return;
  console.log(`\n${lead}`);
  console.log(`  cd "${PROJECT}"`);
  for (const s of ownerSteps) console.log(`  ${s}`);
}

if (VERIFY) {
  /* In team mode drift is a copy that is missing or stale; in local mode it
   * is anything the install still lacks, the plugin included. */
  const teamDrift = (a) => ["overwrite", "create", "replace"].includes(a.kind) && a.cls !== "record";
  const drift = [...actions.filter((a) => (MODE === "local" ? a.cls !== "record" : teamDrift(a))), ...refusals];
  if (JSON_OUT) {
    console.log(JSON.stringify({ project: PROJECT, vault: VAULT, mode: MODE, drift }, null, 2));
  } else if (drift.length === 0) {
    console.log(MODE === "local" ? "OK — the personal install is complete: plugin, rules file, exclude." : "OK — every deployable file matches its source in Knowledge-OS/Dist.");
  } else {
    console.log(`${drift.length} item(s) differ from Dist or are not installed:\n`);
    for (const d of drift) console.log(`  ${d.path}  — ${d.detail ?? d.why}`);
  }
  process.exit(drift.length === 0 ? 0 : 1);
}

if (JSON_OUT) {
  console.log(
    JSON.stringify(
      { project: PROJECT, vault: VAULT, mode: MODE, modeFrom: CHOSEN.how, recommended: RECOMMENDED, uninstall: UNINSTALL, classes: CLASSES, actions, refusals, notes, ownerSteps, applyCommand: applyCommand() },
      null,
      2
    )
  );
} else {
  /* `.os-version` had no reader at all until this line: it said `os-v1` while
   * CHANGELOG had reached os-v2, and nothing noticed because nothing looked.
   * Reporting it here gives the file a consumer and makes a stale value
   * visible on every deployment. The install record carries it too. */
  console.log(`Project root : ${PROJECT}`);
  console.log(`Vault        : ${VAULT}${osVersion ? `  (${osVersion})` : ""}`);
  console.log(`Mode         : ${CHOSEN.mode ? `${MODE}  (${CHOSEN.how})` : `none chosen — recommended: ${MODE}, because ${RECOMMENDED.why}`}${UNINSTALL ? "  — UNINSTALL" : ""}\n`);
  for (const [what, state] of census()) console.log(`  ${what.padEnd(22)} ${state}`);
  console.log("");

  if (actions.length === 0) {
    console.log(UNINSTALL ? "Nothing to remove — nothing of ours is installed in scope." : "Nothing to change — every class in scope is already in place.");
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
  if (!JSON_OUT) {
    console.log(`\nThis was a plan; nothing was written. To carry it out, run this yourself:`);
    console.log(`  ${applyCommand()}`);
    if (!CHOSEN.mode) console.log(`(Name a mode — --local or --team — to apply; the plan above is for ${MODE}.)`);
    printOwnerSteps(UNINSTALL ? "and first, Claude Code's own commands:" : "and then Claude Code's own commands:");
  }
  process.exit(0);
}

if (!CHOSEN.mode) {
  console.error(`\nNo mode chosen. Recommended: --${MODE === "standalone" ? "team" : MODE} (${RECOMMENDED.why}). Re-run with --local or --team.`);
  process.exit(1);
}

if (UNINSTALL) {
  applyUninstall();
} else {
  for (const a of actions) {
    if (a.cls === "commands" || a.cls === "hooks") {
      const sub = a.cls === "commands" ? "commands" : "hooks";
      const name = a.path.split(sep).pop();
      const to = join(CLAUDE_DIR, sub, name);
      ensureDir(dirname(to));
      writeFileSync(to, readFileSync(join(DIST, sub, name), "utf8"), "utf8");
    }
    if (a.cls === "rules") applyRules();
  }
  if (CLASSES.includes("settings")) applySettings(plans.settings);
  if (CLASSES.includes("claude-md")) applyClaudeMd(plans.claudeMd);
  if (CLASSES.includes("gitignore")) applyGitignore(plans.gitignore);
  if (CLASSES.includes("exclude")) applyExclude(plans.exclude);
  if (plans.config) writeFileSync(CONFIG_PATH, plans.config, "utf8");

  /* Written last, from what is on disk now rather than from the plan, so the
   * record states what was installed, including what an earlier apply left. */
  const text = recordText();
  if (readIfExists(RECORD_PATH) !== text) {
    ensureDir(dirname(RECORD_PATH));
    writeFileSync(RECORD_PATH, text, "utf8");
  }
}

if (!JSON_OUT) {
  const done = actions.filter((a) => a.kind !== "owner").length;
  console.log(`\n${UNINSTALL ? "Removed" : "Applied"} ${done} change(s).`);
  if (plans.claudeMd?.inbox) {
    console.log(`\nA copy of the host's CLAUDE.md is now at:`);
    console.log(`  ${relative(PROJECT, plans.claudeMd.inbox)}`);
    console.log(`Distributing it into Project-OS is a judgement call and is deliberately not done here.`);
  }
  printOwnerSteps(UNINSTALL ? "Still to do, by you — Claude Code's own commands:" : "Still to do, by you — Claude Code's own commands, then restart Claude Code in this project:");
  console.log(`\nNothing was staged or committed. Next:`);
  console.log(`  node "${join(VAULT, "Knowledge-OS", "Tools", "mv.cjs")}" ${UNINSTALL ? "adopt" : "validate-vault"}`);
}

process.exit(refusals.length ? 2 : 0);
