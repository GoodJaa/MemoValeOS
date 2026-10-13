#!/usr/bin/env node
/*
 * upgrade.mjs
 *
 * Syncs the OS layer (Knowledge-OS/Rules, Schema, Protocols, Tools, Dist,
 * Project-OS/Templates, Docs, .gitattributes …) from an upstream git ref,
 * restricted to the paths listed in Knowledge-OS/os-manifest. The project
 * root's `.claude/` is not among them and cannot be: it is deployed from
 * Knowledge-OS/Dist by adopt.mjs after the upgrade.
 *
 * This is a checkout, not a merge: it replaces the local content of each
 * manifest path with the upstream ref's content wholesale. Deciding *which*
 * direction each path should go (take upstream, push local, or diverge on
 * purpose) is not this script's job — that decision is recorded in
 * CHANGELOG.md before this script ever runs. Running this script means the
 * decision was already "take upstream for this path."
 *
 * Usage:
 *   node "Knowledge-OS/Tools/upgrade.mjs" <git-ref>
 *   node "Knowledge-OS/Tools/upgrade.mjs" <git-ref> --yes   (skip confirmation prompt)
 *
 * Exit code is 1 on any precondition failure (dirty tree, ref not found,
 * diff touches a path outside the manifest) or user declining. Nothing is
 * written to disk unless the confirmation step passes.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
/* The repository root is the nearest ancestor holding `.git`, starting at the
 * vault itself — not `dirname(VAULT)`. Both layouts are real: this vault is a
 * subfolder of a larger project, while the upstream distribution repository IS
 * its own vault root. `toVaultRelative` below was already written for both
 * ("a no-op when VAULT == REPO_ROOT"); it was simply being fed the wrong root.
 * Falling back to VAULT rather than throwing keeps a vault with no git history
 * of its own working. */
function findRepoRoot(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return start;
  }
}

const REPO_ROOT = findRepoRoot(VAULT);
const MANIFEST_PATH = join(VAULT, "Knowledge-OS", "os-manifest");

const args = process.argv.slice(2);
const AUTO_YES = args.includes("--yes");
const REF = args.find((a) => !a.startsWith("--"));

if (!REF) {
  console.error("Usage: node upgrade.mjs <git-ref> [--yes]");
  process.exit(1);
}

function git(cmdArgs) {
  return execFileSync("git", cmdArgs, { cwd: REPO_ROOT, encoding: "utf8" });
}

/* ------------------------------------------------------------- manifest */

/* os-manifest: one path/glob per line, relative to VAULT. A leading `!`
 * excludes a path that a broader pattern above it would otherwise include
 * (used for Project-OS/Templates/Task.md — a deliberate divergence, see
 * CHANGELOG.md). Blank lines and lines starting with # are ignored. */
function loadManifest() {
  const raw = readFileSync(MANIFEST_PATH, "utf8");
  const includes = [];
  const excludes = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (trimmed.startsWith("!")) excludes.push(trimmed.slice(1).trim());
    else includes.push(trimmed);
  }
  return { includes, excludes };
}

/* Minimal glob: `*` matches within one segment, `**` across segments,
 * everything else is literal — `?` included. This is the same reading as
 * validate-vault.mjs and manifest.mjs, so the three readers that judge a
 * path against os-manifest cannot disagree about it. It is deliberately not a
 * general-purpose glob: os-manifest only ever needs `dir/**`, `dir/*.ext` and
 * exact paths, and a hand-rolled matcher for exactly those shapes is easier to
 * audit than a dependency pulled in for one script.
 *
 * An earlier version marked `**` with a sentinel built from literal NUL bytes.
 * It matched correctly, but a NUL makes git treat the whole file as binary: no
 * line diff, no three-way merge, and a change on both sides of a sync became a
 * whole-file conflict nobody could resolve by reading. */
function globToRegExp(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
      } else out += "[^/]*";
    } else if (".+^${}()|[]\\?".includes(c)) out += "\\" + c;
    else out += c;
  }
  return new RegExp(`^${out}$`);
}

function matchesAny(relPath, patterns) {
  const norm = relPath.split(sep).join("/");
  return patterns.some((p) => globToRegExp(p).test(norm));
}

function isManifestPath(relPath) {
  const { includes, excludes } = manifest;
  if (!matchesAny(relPath, includes)) return false;
  if (matchesAny(relPath, excludes)) return false;
  return true;
}

const manifest = loadManifest();

/* --------------------------------------------------------- preconditions */

const dirty = git(["status", "--porcelain"]).trim();
if (dirty) {
  console.error("Working tree is not clean. Commit or stash before upgrading:");
  console.error(dirty);
  process.exit(1);
}

try {
  git(["rev-parse", "--verify", `${REF}^{commit}`]);
} catch {
  console.error(`Ref \`${REF}\` does not resolve to a commit. Fetch it first if it's remote.`);
  process.exit(1);
}

/* --------------------------------------------------------------- diff */

/* VAULT can be the repo root itself (standalone MemoValeOS clone) or a
 * subfolder of a larger repo (this project). Diff paths from `git diff`
 * are repo-root-relative; os-manifest paths are vault-relative. Only the
 * subfolder case needs a prefix stripped before matching against the
 * manifest — do it unconditionally, it is a no-op when VAULT == REPO_ROOT. */
const vaultPrefix = relative(REPO_ROOT, VAULT).split(sep).join("/");
function toVaultRelative(repoRelPath) {
  if (!vaultPrefix) return repoRelPath;
  const prefix = vaultPrefix + "/";
  return repoRelPath.startsWith(prefix) ? repoRelPath.slice(prefix.length) : null;
}

const changedFiles = git(["diff", "--name-only", `${REF}`, "HEAD", "--", vaultPrefix || "."])
  .split("\n")
  .filter(Boolean);

const inManifest = [];
const outsideManifest = [];

for (const repoRelPath of changedFiles) {
  const vaultRelPath = toVaultRelative(repoRelPath);
  if (vaultRelPath === null) {
    outsideManifest.push(repoRelPath); // outside the vault entirely — should not happen given the pathspec above
    continue;
  }
  if (isManifestPath(vaultRelPath)) inManifest.push(repoRelPath);
  else outsideManifest.push(repoRelPath);
}

if (outsideManifest.length > 0) {
  console.error(`Diff against ${REF} touches ${outsideManifest.length} path(s) outside os-manifest:`);
  for (const p of outsideManifest) console.error(`  ${p}`);
  console.error("Refusing to proceed — update os-manifest first if this is expected, or narrow the ref.");
  process.exit(1);
}

if (inManifest.length === 0) {
  console.log(`No manifest-covered paths differ from ${REF}. Nothing to do.`);
  process.exit(0);
}

console.log(`Paths to update from ${REF} (${inManifest.length}):`);
for (const p of inManifest) console.log(`  ${p}`);
console.log("");
console.log(git(["diff", "--stat", REF, "HEAD", "--", ...inManifest]));

/* --------------------------------------------------------- confirmation */

async function confirm() {
  if (AUTO_YES) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise((resolve) => rl.question(`Check out ${inManifest.length} path(s) from ${REF}? [y/N] `, resolve));
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

const ok = await confirm();
if (!ok) {
  console.log("Aborted — nothing changed.");
  process.exit(0);
}

/* ------------------------------------------------------------ checkout */

git(["checkout", REF, "--", ...inManifest]);
console.log(`Checked out ${inManifest.length} path(s) from ${REF}. Review with \`git diff --staged\` (or \`git diff\`) before committing.`);
