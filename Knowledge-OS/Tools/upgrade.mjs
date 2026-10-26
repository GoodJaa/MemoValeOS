#!/usr/bin/env node
/**
 * upgrade.mjs — bring this copy's OS layer up to a newer version, with no
 * history in common with it.
 *
 * It used to `git checkout <ref> -- <manifest paths>`, which works only when
 * the vault's own git history contains upstream's commits. Since os-v5
 * upstream shares no history with anyone, an installed copy often has no git
 * of its own at all (the first real installation deleted the vault's `.git`
 * as "not needed"), and a personal install keeps the vault out of the
 * project's git. None of those could upgrade.
 *
 * Now it compares files, three ways, for every path of the OS layer:
 *
 *   - local: what this copy has;
 *   - new:   what the new version has (`--from`, a directory or
 *            `github:owner/repo@ref`);
 *   - base:  what this copy was at its last install or upgrade — hashes from
 *            `.mvos/os-base.json`, which every successful upgrade writes, or
 *            the contents of `--base` (a directory or `github:…@ref`) for a
 *            copy that has no such file yet.
 *
 * Unchanged here → take the new version (or remove a file the new version
 * dropped). Changed only here → keep it. Changed on both sides → a three-way
 * `git merge-file` when the base's contents are at hand and the merge is
 * clean; otherwise a conflict: the local file stays, and the new version is
 * written beside it as `<path>.mvos-new` for a human to merge. With no base
 * at all, every difference is a conflict (or, with --yes, taken from the new
 * version).
 *
 * Never touched: files each copy keeps for itself (README.md, CLAUDE.md,
 * Backlog.md…), the project's settings and install record (mvos.config.json,
 * .mvos/), and anything the manifest excludes with `!`.
 *
 * Checked by running, before and after: the validator. If the upgrade makes a
 * rule that already existed report more errors, stops the validator from
 * running, or leaves a script that does not parse, every file is put back as
 * it was. New rules reporting errors are not a failure: they are the migration
 * CHANGELOG names under "Что валидатор начал требовать", and the report lists
 * them. Neither is `deployed-command-drift`: the deployed copies are behind
 * their new sources until the owner re-applies the install, which the report
 * asks for. A version whose CHANGELOG says an existing rule got stricter is
 * taken with --accept-errors, and the errors are then fixed by hand.
 *
 * The tests are not run: an installed copy has no dev dependencies, and they
 * are the OS's own definition of done (os-check.mjs), checked where the OS is
 * developed.
 *
 * Usage:
 *   node "Knowledge-OS/Tools/mv.cjs" upgrade --from <dir|github:owner/repo@ref>          # plan
 *   node "Knowledge-OS/Tools/mv.cjs" upgrade --from … --base <dir|github:owner/repo@ref>
 *   node "Knowledge-OS/Tools/mv.cjs" upgrade --from … --apply [--yes] [--accept-errors]
 *   node "Knowledge-OS/Tools/mv.cjs" upgrade --from … --json
 *   node "<new>/Knowledge-OS/Tools/upgrade.mjs" --vault <copy> --from <new> --base …   # a copy older than os-v6
 *
 * `github:owner/repo@ref` is cloned with git into a temporary directory. With
 * a `github:` source and no base, the base is the same repository at this
 * copy's `.os-version` tag, when that tag exists there.
 *
 * Exit codes: 0 planned, done, or nothing to do; 1 a precondition failed; 2
 * applied, with conflicts left for a human; 3 rolled back.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync, mkdtempSync } from "node:fs";
import { join, dirname, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readManifest, PER_COPY_FILES } from "./manifest.mjs";

const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const value = (n) => {
  const i = argv.indexOf(n);
  return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
};

/* The copy to upgrade: the vault this script is in, or --vault. A copy older
 * than os-v6 has only the git-based upgrade.mjs, so its first upgrade runs the
 * new version's script against it: `node <new>/Knowledge-OS/Tools/upgrade.mjs
 * --vault <copy> --from <new>`. */
const VAULT = value("--vault") ? resolve(value("--vault")) : dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const APPLY = flag("--apply");
const YES = flag("--yes");
const ACCEPT_ERRORS = flag("--accept-errors");
const JSON_OUT = flag("--json");

const norm = (s) => s.replace(/\r\n/g, "\n");
const sha256 = (s) => createHash("sha256").update(norm(s)).digest("hex");
const readIfExists = (p) => {
  try {
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
};
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

/* ---------------------------------------------------------------- sources */

const temps = [];
process.on("exit", () => {
  for (const t of temps) rmSync(t, { recursive: true, force: true });
});

/* A directory as given, or a `github:owner/repo@ref` cloned at that ref. */
function resolveSource(spec, role) {
  const m = /^github:([\w.-]+\/[\w.-]+)@(.+)$/.exec(spec);
  if (!m) {
    if (!existsSync(join(spec, "Knowledge-OS", "os-manifest"))) fail(`${role} \`${spec}\` is not a MemoValeOS vault: no Knowledge-OS/os-manifest there.`);
    return spec;
  }
  const dir = mkdtempSync(join(tmpdir(), "mv-upgrade-src-"));
  temps.push(dir);
  try {
    execFileSync("git", ["clone", "--quiet", "--depth", "1", "--branch", m[2], `https://github.com/${m[1]}.git`, dir], { stdio: ["ignore", "ignore", "pipe"] });
  } catch (e) {
    return { error: `cannot clone ${m[1]} at ${m[2]}: ${String(e.stderr || e.message).trim().split("\n").pop()}` };
  }
  return dir;
}

const FROM = value("--from");
if (!FROM) fail('Usage: node "Knowledge-OS/Tools/mv.cjs" upgrade --from <dir|github:owner/repo@ref> [--base <dir|github:…>] [--vault <dir>] [--apply] [--yes] [--accept-errors]');
if (!existsSync(join(VAULT, "Knowledge-OS", "os-manifest"))) fail(`\`${VAULT}\` is not a MemoValeOS vault: no Knowledge-OS/os-manifest there.`);
const NEW = resolveSource(FROM, "--from");
if (NEW.error) fail(NEW.error);
if (relative(NEW, VAULT) === "") fail("--from is this vault itself; name the new version's directory.");

/* Never the new version's to decide, never ours to overwrite. */
const STATE = ["mvos.config.json"];
const untouchable = (p) => PER_COPY_FILES.includes(p) || STATE.includes(p) || p.startsWith(".mvos/");

function walk(root) {
  const out = [];
  (function go(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if ([".git", "node_modules", ".mvos"].includes(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) go(full);
      else out.push(relative(root, full).split(sep).join("/"));
    }
  })(root);
  return out;
}

const newIsOs = readManifest(NEW);
const localIsOs = readManifest(VAULT) ?? (() => false);
if (!newIsOs) fail(`--from has no Knowledge-OS/os-manifest.`);

/* -------------------------------------------------------------------- base */

const BASE_FILE = join(VAULT, ".mvos", "os-base.json");
const osVersion = (dir) => (readIfExists(join(dir, ".os-version")) ?? "").trim() || null;

/* baseOf(path): { known: false } when nothing tells; otherwise { known: true,
 * hash: string|null, text?: string } — hash null meaning "not in the base". */
let baseOf = () => ({ known: false });
let baseFrom = "none";
const baseSpec = value("--base") ?? (/^github:/.test(FROM) && osVersion(VAULT) ? FROM.replace(/@.+$/, `@${osVersion(VAULT)}`) : null);

if (value("--base") || (!existsSync(BASE_FILE) && baseSpec)) {
  const dir = resolveSource(baseSpec, "--base");
  if (dir.error) {
    if (value("--base")) fail(dir.error);
    baseFrom = `none (${dir.error})`;
  } else {
    const isOs = readManifest(dir) ?? (() => false);
    const texts = new Map(walk(dir).filter((p) => isOs(p)).map((p) => [p, readFileSync(join(dir, p), "utf8")]));
    baseOf = (p) => (texts.has(p) ? { known: true, hash: sha256(texts.get(p)), text: texts.get(p) } : { known: true, hash: null });
    baseFrom = value("--base") ? `--base ${baseSpec}` : `${baseSpec} (this copy's .os-version)`;
  }
} else if (existsSync(BASE_FILE)) {
  try {
    const b = JSON.parse(readFileSync(BASE_FILE, "utf8"));
    const files = b.files ?? {};
    baseOf = (p) => ({ known: true, hash: files[p] ?? null });
    baseFrom = `.mvos/os-base.json (${b.osVersion ?? "unknown version"})`;
  } catch {
    baseFrom = "none (.mvos/os-base.json does not parse)";
  }
}

/* ------------------------------------------------------------------- plan */

const paths = new Set();
for (const p of walk(NEW)) if (newIsOs(p) && !untouchable(p)) paths.add(p);
for (const p of walk(VAULT)) if ((newIsOs(p) || localIsOs(p)) && !untouchable(p) && !p.endsWith(".mvos-new")) paths.add(p);

const GIT = spawnSync("git", ["--version"]).status === 0;

/* A clean three-way merge, or null. */
function merge3(local, base, incoming) {
  if (!GIT) return null;
  const dir = mkdtempSync(join(tmpdir(), "mv-merge-"));
  try {
    const [l, b, n] = ["local", "base", "new"].map((x) => join(dir, x));
    writeFileSync(l, norm(local));
    writeFileSync(b, norm(base));
    writeFileSync(n, norm(incoming));
    const r = spawnSync("git", ["merge-file", "-p", l, b, n], { encoding: "utf8" });
    return r.status === 0 ? r.stdout : null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const plan = []; // {path, kind, detail, write?: string|null (null removes), side?: the new version beside a conflict}
let same = 0;
for (const p of [...paths].sort()) {
  /* The new manifest excludes a file the new version still has: it was handed
   * to each copy, like Templates/Task.md. Not the upgrade's to touch. */
  if (!newIsOs(p) && existsSync(join(NEW, p))) continue;
  const l = readIfExists(join(VAULT, p));
  const n = newIsOs(p) ? readIfExists(join(NEW, p)) : null;
  if (l !== null && n !== null && norm(l) === norm(n)) {
    same++;
    continue;
  }
  if (l === null && n === null) continue;
  const b = baseOf(p);
  const hl = l === null ? null : sha256(l);
  const hn = n === null ? null : sha256(n);
  if (b.known && hl === b.hash) {
    if (n === null) plan.push({ path: p, kind: "remove", detail: "unchanged here; the new version no longer has it", write: null });
    else plan.push({ path: p, kind: l === null ? "add" : "update", detail: l === null ? "new in this version" : "unchanged here; taken from the new version", write: n });
  } else if (b.known && hn === b.hash) {
    plan.push({ path: p, kind: "keep", detail: l === null ? "removed here; the new version did not touch it" : "changed here; the new version did not touch it" });
  } else if (!b.known && l === null) {
    plan.push({ path: p, kind: "add", detail: "new in this version", write: n });
  } else if (!b.known && n === null) {
    plan.push({ path: p, kind: "keep", detail: "not in the new version; kept, since nothing says whether it was changed here" });
  } else {
    const merged = b.text !== undefined && l !== null && n !== null ? merge3(l, b.text, n) : null;
    const how = l === null ? "removed here and changed in the new version" : n === null ? "changed here and removed in the new version" : "changed on both sides";
    if (merged !== null) plan.push({ path: p, kind: "merge", detail: `${how}; merged cleanly`, write: merged });
    else if (YES) plan.push({ path: p, kind: "overwrite", detail: `${b.known ? how : "differs, with no base"}; the new version taken (--yes)`, write: n });
    else plan.push({ path: p, kind: "conflict", detail: b.known ? `${how}; merge it by hand` : "differs, and there is no base to tell which side changed", side: n });
  }
}

const counts = plan.reduce((c, a) => ((c[a.kind] = (c[a.kind] ?? 0) + 1), c), {});
const fromVersion = osVersion(VAULT);
const toVersion = osVersion(NEW);

/* What has to happen outside the vault afterwards, for the human: the install
 * copies from Dist/, so a changed Dist/ is behind in the project until the
 * owner re-applies it (.claude/ is a protected path; Deployment Protocol §4). */
function ownerSteps() {
  let mode = null;
  try {
    mode = JSON.parse(readFileSync(join(VAULT, ".mvos", "install.json"), "utf8")).mode;
  } catch {
    /* no record */
  }
  const touched = (prefix) => plan.some((a) => a.path.startsWith(prefix) && a.write !== undefined);
  const mv = `node "${join(VAULT, "Knowledge-OS", "Tools", "mv.cjs")}"`;
  const steps = [];
  if (!touched("Knowledge-OS/Dist/") && !touched(".claude-plugin/")) return steps;
  /* Without a record, which install this copy has is the owner's to say:
   * adopt plans for both and recommends one. */
  if (!mode) return [`${mv} adopt`];
  const pluginTouched = touched("Knowledge-OS/Dist/plugin/") || touched(".claude-plugin/");
  if (mode !== "local" || plan.some((a) => a.write !== undefined && a.path.startsWith("Knowledge-OS/Dist/") && !a.path.startsWith("Knowledge-OS/Dist/plugin/"))) {
    steps.push(`${mv} adopt --apply --yes`);
  }
  if (mode === "local" && pluginTouched) steps.push("claude plugin marketplace update memovaleos", "claude plugin update mv@memovaleos --scope local");
  return steps;
}

function report() {
  if (JSON_OUT) {
    const rows = plan.map((a) => ({ path: a.path, kind: a.kind, detail: a.detail }));
    console.log(JSON.stringify({ vault: VAULT, from: FROM, fromVersion, toVersion, base: baseFrom, same, counts, plan: rows, ownerSteps: ownerSteps() }, null, 2));
    return;
  }
  console.log(`Vault : ${VAULT}  (${fromVersion ?? "no .os-version"})`);
  console.log(`From  : ${FROM}  (${toVersion ?? "no .os-version"})`);
  console.log(`Base  : ${baseFrom}\n`);
  console.log(`${same} OS-layer file(s) already identical.`);
  if (!plan.length) {
    console.log("Nothing to change.");
    return;
  }
  for (const kind of ["update", "add", "remove", "merge", "overwrite", "keep", "conflict"]) {
    const rows = plan.filter((a) => a.kind === kind);
    if (!rows.length) continue;
    console.log(`\n${kind} (${rows.length}):`);
    for (const a of rows) console.log(`  ${a.path}  — ${a.detail}`);
  }
}

report();

if (!APPLY) {
  if (!JSON_OUT) {
    console.log(`\nThis was a plan; nothing was written. Re-run with --apply to carry it out.`);
    if (counts.conflict) console.log(`Conflicts keep the local file and write the new version beside it as <path>.mvos-new; --yes takes the new version instead.`);
  }
  process.exit(0);
}

/* ------------------------------------------------------------------- apply */

const VALIDATOR = join(VAULT, "Knowledge-OS", "Tools", "validate-vault.mjs");

function validate() {
  if (!existsSync(VALIDATOR)) return null;
  const r = spawnSync(process.execPath, [VALIDATOR, "--json"], { encoding: "utf8" });
  try {
    const out = JSON.parse(r.stdout);
    const byRule = {};
    for (const e of out.errors) byRule[e.rule] = (byRule[e.rule] ?? 0) + 1;
    return { byRule, total: out.errors.length };
  } catch {
    return { broken: (r.stderr || r.stdout || "").trim().split("\n").slice(-3).join(" | ") };
  }
}

const ruleIds = (src) => new Set([...(src ?? "").matchAll(/(?:err|warn)\(\s*[^,()]+,\s*"([a-z-]+)"/g)].map((m) => m[1]));
const before = validate();
const oldRules = ruleIds(readIfExists(VALIDATOR));

const backups = new Map(); // path → previous text, or null if it did not exist
const writeFile = (p, text) => {
  const full = join(VAULT, p);
  if (!backups.has(p)) backups.set(p, readIfExists(full));
  if (text === null) rmSync(full, { force: true });
  else {
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, text, "utf8");
  }
};

for (const a of plan) {
  if (a.write !== undefined) writeFile(a.path, a.write);
  if (a.kind === "conflict" && a.side !== undefined && a.side !== null) writeFile(`${a.path}.mvos-new`, a.side);
}

function rollback(why) {
  for (const [p, text] of backups) {
    const full = join(VAULT, p);
    if (text === null) rmSync(full, { force: true });
    else writeFileSync(full, text, "utf8");
  }
  console.error(`\nRolled back — every file is as it was. ${why}`);
  process.exit(3);
}

const unparsable = [...backups.keys()]
  .filter((p) => /\.(mjs|cjs)$/.test(p) && existsSync(join(VAULT, p)))
  .filter((p) => spawnSync(process.execPath, ["--check", join(VAULT, p)]).status !== 0);
if (unparsable.length) rollback(`These no longer parse: ${unparsable.join(", ")}.`);

/* Fixed by the owner's re-apply, which the report asks for, not by undoing
 * the upgrade. */
const OWNER_FIXES = new Set(["deployed-command-drift"]);
const ran = (v) => v && !v.broken;

const after = validate();
if (ran(before) && after?.broken) rollback(`The validator no longer runs: ${after.broken}`);
const compared = ran(before) && ran(after);
const worse = compared ? Object.entries(after.byRule).filter(([rule, n]) => oldRules.has(rule) && !OWNER_FIXES.has(rule) && n > (before.byRule[rule] ?? 0)) : [];
const worseText = worse.map(([r, n]) => `${r} ${before.byRule[r] ?? 0} → ${n}`).join(", ");
if (worse.length && !ACCEPT_ERRORS) {
  rollback(
    `Rules that already existed report more errors: ${worseText}. If the new version's CHANGELOG says one of them got stricter, take it with --accept-errors and fix them by hand.`
  );
}
const migrations = compared ? Object.entries(after.byRule).filter(([rule]) => !oldRules.has(rule)) : [];

/* The new base is the version just taken, whatever was kept locally: the
 * next upgrade asks what changed here since *this* version. */
const baseFiles = {};
for (const p of walk(NEW)) if (newIsOs(p) && !untouchable(p)) baseFiles[p] = sha256(readFileSync(join(NEW, p), "utf8"));
mkdirSync(dirname(BASE_FILE), { recursive: true });
writeFileSync(BASE_FILE, JSON.stringify({ format: 1, osVersion: toVersion, files: baseFiles }, null, 2) + "\n", "utf8");
if (toVersion) writeFileSync(join(VAULT, ".os-version"), toVersion + "\n", "utf8");

if (!JSON_OUT) {
  const written = plan.filter((a) => a.write !== undefined).length;
  console.log(`\nApplied: ${written} file(s) written or removed${toVersion ? `; .os-version is now ${toVersion}` : ""}.`);
  if (ran(after)) console.log(`Validator: ${after.total} error(s) after, ${ran(before) ? before.total : "?"} before.`);
  else if (after?.broken) console.log(`Validator: still does not run (${after.broken}).`);
  if (worse.length) console.log(`Taken with --accept-errors although rules that already existed report more errors: ${worseText}.`);
  if (compared && after.byRule["deployed-command-drift"] > (before.byRule["deployed-command-drift"] ?? 0)) {
    console.log(`The deployed copies are now behind their sources (deployed-command-drift) until the install is re-applied — below.`);
  }
  if (migrations.length) {
    console.log(`New rules now report errors — the migration the new version asks for (CHANGELOG, "Что валидатор начал требовать"):`);
    for (const [r, n] of migrations) console.log(`  ${r}: ${n}`);
  }
  if (counts.conflict) {
    console.log(`\n${counts.conflict} conflict(s) left for you: each local file is unchanged, and the new version is beside it as <path>.mvos-new.`);
  }
  const steps = ownerSteps();
  if (steps.length) {
    console.log(`\nThen, outside the vault — for you to run:`);
    for (const s of steps) console.log(`  ${s}`);
  }
}

process.exit(counts.conflict ? 2 : 0);
