#!/usr/bin/env node
/**
 * os-share.mjs — C3 from git: how much of the work on this vault was work on
 * the operating system itself.
 *
 * C3 used to be read off the metrics log: the share of rows labelled
 * `maintenance`. That counts sessions that wrote a row, and work on the OS is
 * exactly the work that tends not to: a fifteen-commit OS pass closed with no
 * row at all, a 24k-word documentation pass was labelled `task`, and the log
 * held three maintenance rows out of 31 while git said most changed lines were
 * in the OS layer. A share computed from what happened is not a share of what
 * was recorded.
 *
 * So the question goes to git. For every commit that touched the vault: did it
 * touch the OS layer, and how many changed lines fell there. The OS layer is
 * what `Knowledge-OS/os-manifest` names plus the per-copy files of the system
 * (README, CLAUDE.md, the OS backlog — PER_COPY_FILES in manifest.mjs), with a
 * path from before the space-free rename read under its current name. Plans/
 * and Metrics/ are not in it. Grouped by ISO week, because a single total
 * hides the moment a freeze ended.
 *
 * Usage, from anywhere — the vault is found from this file's location:
 *   node "Knowledge-OS/Tools/os-share.mjs"
 *   node "Knowledge-OS/Tools/os-share.mjs" --since 2026-09-01
 *   node "Knowledge-OS/Tools/os-share.mjs" --json
 *
 * Lines are `--numstat` added + deleted, with renames shown as a delete and an
 * add (`--no-renames`), so a mass rename or a translation counts every line it
 * moved. That is what happened to the files, but not what anyone would call
 * work; a week dominated by one such commit is easy to spot in the per-week
 * table. Binary files count as touched, with no lines. Merge commits carry no
 * diff in `git log` and are not counted. The threshold C3 is compared against
 * is not here: this prints the share, the documents say what it is held to.
 */
import { realpathSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { PER_COPY_FILES, currentPathName, readManifest } from "./manifest.mjs";

const RECORD = "\x1e";

/* ------------------------------------------------------------ pure parts */

/* `git log --numstat --format=<RS>%H%x09%aI` → [{hash, date, files: [{path,
 * added, deleted}]}]. A binary file reports `-` for both counts. */
export function parseNumstatLog(raw) {
  const commits = [];
  for (const chunk of raw.split(RECORD)) {
    const lines = chunk.split(/\r?\n/).filter((l) => l.trim());
    if (!lines.length) continue;
    const [hash, date] = lines[0].split("\t");
    const files = [];
    for (const line of lines.slice(1)) {
      const m = line.match(/^(-|\d+)\t(-|\d+)\t(.+)$/);
      if (!m) continue;
      files.push({ path: m[3], added: m[1] === "-" ? 0 : Number(m[1]), deleted: m[2] === "-" ? 0 : Number(m[2]) });
    }
    commits.push({ hash, date, files });
  }
  return commits;
}

/* ISO 8601 week of a date, as `2026-W41`. Weeks start on Monday; week 1 is
 * the one holding the year's first Thursday. The date part is read as a
 * calendar date, not shifted by the local time zone. */
export function isoWeek(dateString) {
  const [y, m, d] = dateString.slice(0, 10).split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/* Totals and per-week figures. `toVault` maps a repository path to a
 * vault-relative one (null when outside the vault); `isOs` is the manifest. */
export function aggregate(commits, toVault, isOs) {
  const empty = () => ({ commits: 0, osCommits: 0, lines: 0, osLines: 0 });
  const total = empty();
  const weeks = new Map();
  for (const c of commits) {
    const files = c.files.map((f) => ({ ...f, vaultPath: toVault(f.path) })).filter((f) => f.vaultPath !== null);
    if (!files.length) continue;
    const week = isoWeek(c.date);
    if (!weeks.has(week)) weeks.set(week, empty());
    const w = weeks.get(week);
    let lines = 0;
    let osLines = 0;
    let touchesOs = false;
    for (const f of files) {
      const n = f.added + f.deleted;
      lines += n;
      if (isOs(f.vaultPath)) {
        osLines += n;
        touchesOs = true;
      }
    }
    for (const bucket of [total, w]) {
      bucket.commits++;
      if (touchesOs) bucket.osCommits++;
      bucket.lines += lines;
      bucket.osLines += osLines;
    }
  }
  return {
    total,
    weeks: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, ...v })),
  };
}

/* ------------------------------------------------------------------- run */

function main() {
  const argv = process.argv.slice(2);
  const value = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
  };
  const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

  const inManifest = readManifest(VAULT);
  if (!inManifest) {
    console.error("No Knowledge-OS/os-manifest — cannot tell the OS layer from the project's own knowledge.");
    process.exit(1);
  }
  const isOs = (vaultPath) => {
    const p = currentPathName(vaultPath);
    return inManifest(p) || PER_COPY_FILES.includes(p);
  };

  const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  let repoRoot;
  try {
    repoRoot = git(VAULT, "rev-parse", "--show-toplevel").trim();
  } catch {
    console.error("The vault is not inside a git repository.");
    process.exit(1);
  }
  const vaultPrefix = relative(repoRoot, VAULT).split(sep).join("/");
  const toVault = (p) => (!vaultPrefix ? p : p.startsWith(vaultPrefix + "/") ? p.slice(vaultPrefix.length + 1) : null);

  const args = ["-c", "core.quotepath=off", "log", "--numstat", "--no-renames", `--format=${RECORD}%H%x09%aI`];
  if (value("--since")) args.push(`--since=${value("--since")}`);
  args.push("--", vaultPrefix || ".");
  const result = aggregate(parseNumstatLog(git(repoRoot, ...args)), toVault, isOs);

  if (argv.includes("--json")) {
    console.log(JSON.stringify({ vault: VAULT, since: value("--since"), ...result }, null, 2));
    return;
  }

  const pct = (a, b) => (b ? Math.round((a / b) * 100) + "%" : "—");
  console.log("OS layer share of the work on this vault (os-manifest + per-copy files; git, not the metrics log)");
  console.log("");
  console.log("  week        commits  OS commits  share   lines changed   OS lines   share");
  for (const w of result.weeks) {
    console.log(
      `  ${w.week}  ${String(w.commits).padStart(7)}  ${String(w.osCommits).padStart(10)}  ${pct(w.osCommits, w.commits).padStart(5)}   ${String(w.lines).padStart(13)}  ${String(w.osLines).padStart(9)}  ${pct(w.osLines, w.lines).padStart(6)}`
    );
  }
  const t = result.total;
  console.log("");
  console.log(`  total       ${String(t.commits).padStart(7)}  ${String(t.osCommits).padStart(10)}  ${pct(t.osCommits, t.commits).padStart(5)}   ${String(t.lines).padStart(13)}  ${String(t.osLines).padStart(9)}  ${pct(t.osLines, t.lines).padStart(6)}`);
  console.log("");
  console.log("  Lines count renames and translations as whole-file rewrites; read a week dominated by one such commit accordingly.");
}

/* Run only when invoked directly, so the test can import the pure parts. */
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
