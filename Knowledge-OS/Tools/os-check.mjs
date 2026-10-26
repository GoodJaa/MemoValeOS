#!/usr/bin/env node
/**
 * One command for the OS layer's definition of done.
 *
 * Docs/10-Extending.md ("Готово, когда") says a change to the OS layer is
 * finished only when its documentation is current, its links are intact and
 * its scripts run. Before this tool those were three habits, checked by
 * whoever remembered: `Docs/08-4` named `os-v4` for a release after os-v5
 * shipped, and a new test file stayed out of `npm test` until someone added
 * it by hand. This runs every check that a machine can make, in one place:
 *
 *   1. validate-vault  — 0 errors: links (wikilinks and Markdown), schema,
 *                        manifest coverage, every tool and command documented;
 *   2. tests           — every *.test.mjs, via run-tests.mjs;
 *   3. syntax          — every .mjs/.cjs of the layer passes `node --check`;
 *   4. deployment      — `adopt.mjs --verify` for commands and hooks, when the
 *                        OS is deployed into a project; skipped when it is not;
 *   5. graph           — connected components and isolated notes, reported
 *                        and never failing (graph-report.mjs);
 *   6. docs-with-code  — per commit in a range: a commit that changes
 *                        Knowledge-OS/{Tools,Dist,Schema,Rules,Protocols}
 *                        (tests and fixtures aside) must also change Docs/,
 *                        or carry a `Docs: none — <reason>` trailer; and a
 *                        range holding such commits must change CHANGELOG.md.
 *
 * Every step runs even after one fails, so one run names every problem.
 *
 * Step 6 can see that Docs/ was touched, not that it was touched correctly;
 * that half of the definition stays with whoever makes the change. It is a
 * development check: it runs where the OS is developed and delivered from
 * (the host project, upstream), and says "no history" anywhere else.
 *
 * Usage:
 *   node "Knowledge-OS/Tools/os-check.mjs"                       # range @{u}..HEAD
 *   node "Knowledge-OS/Tools/os-check.mjs" --range origin/master..HEAD
 *   node "Knowledge-OS/Tools/os-check.mjs" --skip tests,syntax
 *
 * Exit codes: 0 every step passed or was skipped; 1 a step failed.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync, execFileSync } from "node:child_process";

const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TOOLS = join(VAULT, "Knowledge-OS", "Tools");
const DIST = join(VAULT, "Knowledge-OS", "Dist");
const NEVER_WALK = ["node_modules", "__fixtures__", "__provider_fixtures__"];

/* ------------------------------------------------------- docs-with-code */

/* Paths whose change means behaviour changed, so documentation is owed. Tests
 * and fixtures are not among them: they pin behaviour that the code change
 * beside them already has to document, and a commit that only adds a fixture
 * describes nothing new. */
const CODE_PREFIXES = ["Tools/", "Dist/", "Schema/", "Rules/", "Protocols/"].map((p) => "Knowledge-OS/" + p);
export const isCodePath = (p) =>
  CODE_PREFIXES.some((pre) => p.startsWith(pre)) &&
  !p.endsWith(".test.mjs") &&
  !p.includes("/__fixtures__/") &&
  !p.includes("/__provider_fixtures__/");
export const isDocsPath = (p) => p.startsWith("Docs/");
/* The waiver has to say why. A bare `Docs: none` is the habit this check
 * exists to break, written as a trailer. */
const DOCS_WAIVER = /^Docs:[ \t]*none[ \t]*[—–-]+[ \t]*\S/im;

/**
 * commits: [{ sha, subject, message, files }] with vault-relative POSIX paths.
 * Returns { codeCommits, problems } — problems is empty when the range is done.
 */
export function checkDocsWithCode(commits) {
  const problems = [];
  const code = commits.filter((c) => c.files.some(isCodePath));
  for (const c of code) {
    if (c.files.some(isDocsPath) || DOCS_WAIVER.test(c.message)) continue;
    const touched = c.files.filter(isCodePath);
    const shown = touched.slice(0, 3).join(", ") + (touched.length > 3 ? `, +${touched.length - 3}` : "");
    problems.push(
      `${c.sha.slice(0, 7)} "${c.subject}" changes ${shown} but not Docs/, ` +
        `and carries no "Docs: none — <reason>" trailer`
    );
  }
  if (code.length && !commits.some((c) => c.files.includes("CHANGELOG.md"))) {
    problems.push(`${code.length} commit(s) in the range change the OS layer, and none of them changes CHANGELOG.md`);
  }
  return { codeCommits: code.length, problems };
}

function git(args) {
  return execFileSync("git", args, { cwd: VAULT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function rangeCommits(range) {
  // `-- .` from the vault's own directory: only commits that touch the vault.
  const shas = git(["rev-list", "--no-merges", range, "--", "."]).split("\n").filter(Boolean);
  return shas.map((sha) => {
    const message = git(["log", "-1", "--format=%B", sha]);
    // --relative: paths relative to the vault, and only the vault's.
    const files = git(["diff-tree", "--root", "--no-commit-id", "--name-only", "-r", "--relative", sha])
      .split("\n")
      .filter(Boolean);
    return { sha, subject: message.split("\n")[0], message, files };
  });
}

function stepDocsWithCode(explicitRange) {
  let range = explicitRange;
  try {
    git(["rev-parse", "--git-dir"]);
  } catch {
    return { status: "skip", detail: "no git history here — nothing to compare" };
  }
  if (!range) {
    try {
      git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
      range = "@{u}..HEAD";
    } catch {
      return { status: "skip", detail: "HEAD has no upstream — pass --range <base>..HEAD" };
    }
  }
  let commits;
  try {
    commits = rangeCommits(range);
  } catch (e) {
    return { status: "fail", detail: `cannot read range ${range}: ${String(e.stderr || e.message).trim()}` };
  }
  const { codeCommits, problems } = checkDocsWithCode(commits);
  if (problems.length) return { status: "fail", detail: `range ${range}`, lines: problems };
  return {
    status: "ok",
    detail: `range ${range}: ${commits.length} commit(s), ${codeCommits} change the OS layer, all with Docs/ and CHANGELOG.md`,
  };
}

/* ------------------------------------------------------------ the steps */

function run(script, args = []) {
  const r = spawnSync(process.execPath, [join(TOOLS, script), ...args], { cwd: VAULT, encoding: "utf8" });
  return { code: r.status === null ? 1 : r.status, out: (r.stdout || "") + (r.stderr || "") };
}

const lastLines = (s, n) => s.trimEnd().split("\n").slice(-n);

function stepValidate() {
  const r = run("validate-vault.mjs");
  const last = lastLines(r.out, 1)[0] || "";
  if (r.code === 0) return { status: "ok", detail: last };
  return { status: "fail", detail: "validator reports errors", lines: r.out.trimEnd().split("\n") };
}

function stepTests() {
  const r = run("run-tests.mjs");
  const summary = r.out.split("\n").filter((l) => /^ℹ (tests|pass|fail) /.test(l)).join(", ").replace(/ℹ /g, "");
  if (r.code === 0) return { status: "ok", detail: summary };
  const failing = r.out.split("\n").filter((l) => /^\s*✖/.test(l));
  return { status: "fail", detail: summary || "node --test failed", lines: failing.length ? failing : lastLines(r.out, 20) };
}

function scriptFiles() {
  const out = [];
  (function walk(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith(".") || NEVER_WALK.includes(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(mjs|cjs)$/.test(e.name)) out.push(full);
    }
  })(join(VAULT, "Knowledge-OS"));
  return out.sort();
}

function stepSyntax() {
  const files = scriptFiles();
  const bad = [];
  for (const f of files) {
    const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
    if (r.status !== 0) bad.push(`${relative(VAULT, f).split(sep).join("/")}: ${lastLines(r.stderr || "", 1)[0] || "does not parse"}`);
  }
  if (bad.length) return { status: "fail", detail: `${bad.length} of ${files.length} file(s) do not parse`, lines: bad };
  return { status: "ok", detail: `${files.length} file(s) parse` };
}

function deployableCount() {
  const commands = readdirSync(join(DIST, "commands")).filter((n) => /^mv-.+\.md$/.test(n)).length;
  const hooks = readdirSync(join(DIST, "hooks")).filter((n) => /\.(mjs|cjs)$/.test(n) && !n.includes(".test.")).length;
  return commands + hooks;
}

function stepDeployment() {
  const r = run("adopt.mjs", ["--verify", "--json", "--only", "commands,hooks"]);
  let report;
  try {
    report = JSON.parse(r.out);
  } catch {
    return { status: "fail", detail: "adopt.mjs --verify did not answer in JSON", lines: lastLines(r.out, 10) };
  }
  const drift = report.drift || [];
  /* Nothing deployed at all is not drift: upstream and a fresh clone have no
   * .claude/ to compare against. Partly deployed is. */
  if (drift.length === deployableCount() && drift.every((d) => d.kind === "create")) {
    return { status: "skip", detail: `not deployed into a project (${report.project})` };
  }
  if (drift.length === 0) return { status: "ok", detail: `deployed copies in ${report.project} match Dist` };
  return {
    status: "fail",
    detail: `${drift.length} deployed file(s) differ from Dist`,
    lines: drift.map((d) => `${d.path} — ${d.detail || d.why}`),
  };
}

function stepGraph() {
  const r = run("graph-report.mjs", ["--json"]);
  try {
    const g = JSON.parse(r.out);
    return {
      status: "info",
      detail: `${g.notes} notes, ${g.components.length} connected component(s), ${g.isolated.length} isolated`,
    };
  } catch {
    return { status: "info", detail: "graph-report.mjs gave no JSON — not a gate, carrying on" };
  }
}

/* ------------------------------------------------------------------ main */

function main() {
  const argv = process.argv.slice(2);
  const value = (n) => {
    const i = argv.indexOf(n);
    return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : null;
  };
  const skip = (value("--skip") || "").split(",").map((s) => s.trim()).filter(Boolean);
  const steps = [
    ["validate-vault", stepValidate],
    ["tests", stepTests],
    ["syntax", stepSyntax],
    ["deployment", stepDeployment],
    ["graph", stepGraph],
    ["docs-with-code", () => stepDocsWithCode(value("--range"))],
  ];
  const unknown = skip.filter((s) => !steps.some(([n]) => n === s));
  if (unknown.length) {
    console.error(`Unknown step(s) for --skip: ${unknown.join(", ")}. Known: ${steps.map(([n]) => n).join(", ")}`);
    process.exit(1);
  }

  const version = (() => {
    try {
      return readFileSync(join(VAULT, ".os-version"), "utf8").trim();
    } catch {
      return "";
    }
  })();
  console.log(`os-check — ${VAULT}${version ? `  (${version})` : ""}\n`);

  let failed = 0;
  steps.forEach(([name, fn], i) => {
    const res = skip.includes(name) ? { status: "skip", detail: "skipped by --skip" } : fn();
    if (res.status === "fail") failed++;
    const mark = { ok: "ok  ", fail: "FAIL", skip: "skip", info: "info" }[res.status];
    console.log(`  [${i + 1}/${steps.length}] ${mark} ${name.padEnd(15)} ${res.detail}`);
    for (const l of res.lines || []) console.log(`           ${l}`);
  });

  console.log(failed ? `\n${failed} step(s) failed — the change is not done (Docs/10-Extending.md, "Готово, когда").` : "\nDone: every check a machine can make has passed.");
  process.exit(failed ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
