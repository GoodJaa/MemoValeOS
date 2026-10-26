#!/usr/bin/env node
/**
 * B8 — detect knowledge whose evidence has moved on without it.
 *
 * `source: [{path, commit}]` records the repository state a statement was
 * established against. That makes a question answerable that prose cannot
 * answer: has the code this note cites changed since the note was written?
 *
 *     git log <commit>..HEAD -- <path>
 *
 * A non-empty answer does not mean the note is wrong. It means the note is
 * unverified — the evidence behind it is no longer the evidence that was
 * checked. That distinction is the whole design: `stale` in Metadata Schema
 * was "set and cleared by hand", which is to say never set at all, because a
 * field only a human can maintain is a field nobody maintains.
 *
 * Usage:
 *   node "Knowledge-OS/Tools/stale-check.mjs"            # human-readable
 *   node "Knowledge-OS/Tools/stale-check.mjs" --json     # machine-readable
 *
 * Run from anywhere: paths in `source` are relative to the repository root —
 * the nearest ancestor of the vault holding `.git` (findRepoRoot), which is
 * the project when MemoValeOS is embedded and the vault itself when it is a
 * standalone clone.
 */
import { readdirSync, readFileSync, statSync , existsSync } from "node:fs";
import { join, sep, dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { load as loadYaml } from "./vendor/js-yaml.mjs"; // vendored, see validate-vault.mjs

const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
/* The repository root is the nearest ancestor holding `.git`, starting at the
 * vault itself — not `dirname(VAULT)`. Both layouts are real: this vault is a
 * subfolder of a larger project, while the upstream distribution repository IS
 * its own vault root. Assuming the parent silently interrogated the wrong
 * repository there for as long as the assumption stood. Falling back to VAULT
 * rather than throwing keeps fixture vaults, which have no git history of
 * their own, working. */
function findRepoRoot(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return start;
  }
}

/* The install record names the project root, as in validate-vault.mjs: with
 * it, a vault that has its own .git still asks the project's repository. */
function projectRootFromRecord() {
  try {
    const r = JSON.parse(readFileSync(join(VAULT, ".mvos", "install.json"), "utf8"));
    return typeof r?.projectRoot === "string" ? resolve(VAULT, r.projectRoot) : null;
  } catch {
    return null;
  }
}

const REPO = findRepoRoot(projectRootFromRecord() ?? VAULT);
const KNOWLEDGE_ROOTS = ["Knowledge-OS", "Project-OS"];
// Keep in step with NEVER_WALK in validate-vault.mjs: a fixture vault walked
// as if it were this one reports test data as the project's own knowledge.
const NEVER_WALK = ["node_modules", "dist", "build", ".next", "coverage", ".git", "__fixtures__", "__provider_fixtures__"];

const asJson = process.argv.includes("--json");

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory() && NEVER_WALK.includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!m) return null;
  try {
    const fm = loadYaml(m[1]);
    return fm && typeof fm === "object" ? fm : null;
  } catch {
    return null; // validate-vault.mjs owns reporting invalid YAML.
  }
}

/**
 * Commits touching `path` after `commit`, exclusive.
 *
 * Returns `null` rather than an empty list when the question cannot be asked —
 * an unknown commit, a path git has never tracked. "Unanswerable" and "nothing
 * changed" must not collapse into the same value: the first is a broken
 * `source` entry and the second is healthy knowledge, and reporting a broken
 * reference as current is exactly the silent failure this tool exists to end.
 */
function commitsSince(commit, path) {
  const opts = { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  try {
    const out = execFileSync("git", ["log", "--format=%h %s", `${commit}..HEAD`, "--", path], opts);
    const commits = out.split("\n").filter(Boolean);
    /* `git log -- <path>` answers "no commits" for a path git has never seen
     * instead of failing, so a typo in `source.path` used to read as current.
     * Untouched since the cited commit means it must still exist at HEAD. */
    if (commits.length === 0) execFileSync("git", ["cat-file", "-e", `HEAD:${path}`], opts);
    return commits;
  } catch {
    return null;
  }
}

function pathIsTracked(path) {
  try {
    const out = execFileSync("git", ["ls-files", "--error-unmatch", path], {
      cwd: REPO,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

const findings = [];

for (const file of walk(VAULT)) {
  const rel = relative(VAULT, file);
  if (!KNOWLEDGE_ROOTS.includes(rel.split(sep)[0])) continue;
  if (rel.startsWith(join("Project-OS", "Templates") + sep)) continue;
  // The validator does not govern these either: command sources and adopted,
  // verbatim host files carry no knowledge `source` of their own.
  if (rel.startsWith(join("Knowledge-OS", "Dist") + sep) || rel.startsWith(join("Project-OS", "Inbox") + sep)) continue;

  const fm = frontmatter(readFileSync(file, "utf8"));
  if (!fm || !Array.isArray(fm.source) || fm.source.length === 0) continue;

  for (const entry of fm.source) {
    if (!entry || typeof entry !== "object") continue;
    const { path, commit } = entry;
    if (typeof path !== "string" || typeof commit !== "string") {
      findings.push({ note: rel, path: String(path), commit: String(commit), kind: "malformed", commits: [] });
      continue;
    }

    const commits = commitsSince(commit, path);
    if (commits === null) {
      findings.push({
        note: rel,
        path,
        commit,
        kind: pathIsTracked(path) ? "unknown-commit" : "untracked-path",
        commits: [],
      });
      continue;
    }
    if (commits.length > 0) {
      findings.push({ note: rel, path, commit, kind: "stale", commits, lifecycle: fm.lifecycle ?? null });
    }
  }
}

if (asJson) {
  console.log(JSON.stringify({ repo: REPO, findings }, null, 2));
  process.exit(0);
}

if (findings.length === 0) {
  console.log("OK — every `source` entry still matches the repository.");
  process.exit(0);
}

const byNote = new Map();
for (const f of findings) {
  if (!byNote.has(f.note)) byNote.set(f.note, []);
  byNote.get(f.note).push(f);
}

console.log(`${findings.length} \`source\` entr(ies) in ${byNote.size} note(s) no longer match the repository.\n`);
console.log("This does not mean the knowledge is wrong. It means the evidence behind it");
console.log("has moved, and nobody has re-checked it since.\n");

for (const [note, entries] of byNote) {
  console.log(`  ${note}`);
  for (const e of entries) {
    if (e.kind === "stale") {
      console.log(`    ${e.path} — ${e.commits.length} commit(s) since ${e.commit}`);
      for (const c of e.commits.slice(0, 3)) console.log(`        ${c}`);
      if (e.commits.length > 3) console.log(`        ... and ${e.commits.length - 3} more`);
    } else if (e.kind === "unknown-commit") {
      console.log(`    ${e.path} — commit ${e.commit} is not in this repository`);
    } else if (e.kind === "untracked-path") {
      console.log(`    ${e.path} — git has never tracked this path`);
    } else {
      console.log(`    ${e.path} — malformed \`source\` entry`);
    }
  }
  console.log("");
}
