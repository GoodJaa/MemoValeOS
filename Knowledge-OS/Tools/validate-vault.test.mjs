#!/usr/bin/env node
/*
 * validate-vault.test.mjs
 *
 * One fixture vault per validator rule, each with exactly one violation.
 * Confirms the rule fires with the expected code, and that everything else
 * in that fixture passes — a rule firing for the wrong reason is as broken
 * as not firing at all.
 *
 * Run: node --test "Knowledge-OS/Tools/validate-vault.test.mjs"
 *
 * Each fixture is a minimal Knowledge-OS + Project-OS tree under
 * __fixtures__/<rule>/. At run time it is copied into a temp directory
 * alongside the real validator and Schema/schema.json, so fixtures stay
 * small and never fall out of sync with the schema they are validated
 * against.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  rmSync,
  cpSync,
  mkdirSync,
  readdirSync,
  statSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, "__fixtures__");
const SCHEMA_JSON = join(HERE, "..", "Schema", "schema.json");
const VALIDATOR = join(HERE, "validate-vault.mjs");

/* The validator imports js-yaml from Tools/vendor/, so a fixture needs that
 * folder beside its copy of the validator. Until 2026-10-25 it was an npm
 * dependency, and this harness probed two node_modules locations for it — the
 * standalone install and the workspace-hoisted one — because hard-coding one
 * had already failed every fixture on a fresh clone once. Copying the
 * vendored file has no location to guess. */
const VENDOR = join(HERE, "vendor");
const withVendor = (vault) => cpSync(VENDOR, join(vault, "Knowledge-OS", "Tools", "vendor"), { recursive: true });

/**
 * Build a throwaway git repository around a fixture vault, so rules that ask
 * git a question have something real to ask.
 *
 * `stale-source` runs `git log <commit>..HEAD -- <path>` against the vault's
 * *parent*, which in a fixture is the temp directory. Without a repository
 * there every commit is unresolvable, and the rule would report "cannot
 * resolve" for both the stale and the current case — passing the positive
 * fixture for entirely the wrong reason while the negative one silently broke.
 *
 * `seed` is `[{path, content}, ...]` committed first; `then` is the same shape
 * committed second. The first commit's short hash is written into the note's
 * `source` by substituting `__COMMIT__`, so the fixture states a real history:
 * evidence recorded at commit 1, code possibly moved by commit 2.
 */
function withGitHistory(vault, seed, then) {
  /* The rule asks git about the repository root — the nearest ancestor of the
   * vault holding `.git` (findRepoRoot) — and `source` paths are relative to
   * it. This harness models the embedded layout: the repository is initialised
   * in the temp directory holding the copied vault, not in the vault itself.
   * The standalone layout has its own harness below. */
  const tmp = dirname(vault);
  const git = (...args) =>
    execFileSync("git", args, { cwd: tmp, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  git("init", "--quiet");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "commit.gpgsign", "false");

  for (const { path: p, content } of seed) {
    mkdirSync(dirname(join(tmp, p)), { recursive: true });
    writeFileSync(join(tmp, p), content);
  }
  git("add", "-A");
  git("commit", "--quiet", "-m", "seed");
  const first = git("rev-parse", "--short", "HEAD").trim();

  if (then.length) {
    for (const { path: p, content } of then) {
      mkdirSync(dirname(join(tmp, p)), { recursive: true });
      writeFileSync(join(tmp, p), content);
    }
    git("add", "-A");
    git("commit", "--quiet", "-m", "later change");
  }
  return first;
}

function runFixture(name, prepare) {
  const src = join(FIXTURES, name);
  const root = mkdtempSync(join(tmpdir(), "mv-vault-"));
  /* The vault sits one level down, so `root` can stand in for the repository
   * that contains it — which is what `stale-source` interrogates with git, and
   * what `source` paths are relative to. Putting the vault at the top would
   * make the repository root the shared system temp directory. */
  const vault = join(root, "vault");
  try {
    cpSync(src, vault, { recursive: true });
    if (prepare) prepare(vault);
    mkdirSync(join(vault, "Knowledge-OS", "Schema"), { recursive: true });
    mkdirSync(join(vault, "Knowledge-OS", "Tools"), { recursive: true });
    cpSync(SCHEMA_JSON, join(vault, "Knowledge-OS", "Schema", "schema.json"));
    cpSync(VALIDATOR, join(vault, "Knowledge-OS", "Tools", "validate-vault.mjs"));
    // validate-vault.mjs imports ./vendor/js-yaml.mjs.
    withVendor(vault);

    const result = execFileSync(process.execPath, [join(vault, "Knowledge-OS", "Tools", "validate-vault.mjs"), "--json"], {
      encoding: "utf8",
    });
    return JSON.parse(result);
  } catch (e) {
    // Non-zero exit is expected when the fixture has an error-level violation.
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* The standalone layout: the vault IS the repository root, which is exactly
 * what the upstream distribution repository is. Every other fixture nests the
 * vault one level down, and that uniformity is why `REPO_ROOT = dirname(VAULT)`
 * survived as long as it did — it is correct in the only shape ever tested.
 * Here git is initialised inside the vault itself, so a tool that assumes the
 * parent asks a repository that does not contain the files it is asking about. */
function runFixtureStandalone(name, prepare) {
  const src = join(FIXTURES, name);
  const root = mkdtempSync(join(tmpdir(), "mv-standalone-"));
  const vault = join(root, "vault");
  try {
    cpSync(src, vault, { recursive: true });
    if (prepare) prepare(vault);
    mkdirSync(join(vault, "Knowledge-OS", "Schema"), { recursive: true });
    mkdirSync(join(vault, "Knowledge-OS", "Tools"), { recursive: true });
    cpSync(SCHEMA_JSON, join(vault, "Knowledge-OS", "Schema", "schema.json"));
    cpSync(VALIDATOR, join(vault, "Knowledge-OS", "Tools", "validate-vault.mjs"));
    withVendor(vault);

    const result = execFileSync(process.execPath, [join(vault, "Knowledge-OS", "Tools", "validate-vault.mjs"), "--json"], {
      encoding: "utf8",
    });
    return JSON.parse(result);
  } catch (e) {
    if (e.stdout) return JSON.parse(e.stdout);
    throw e;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* Seed a repository INSIDE the vault, rather than in its parent. */
function withGitHistoryStandalone(vault, seed, then) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: vault, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  git("init", "--quiet");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "commit.gpgsign", "false");

  for (const { path: p, content } of seed) {
    mkdirSync(dirname(join(vault, p)), { recursive: true });
    writeFileSync(join(vault, p), content);
  }
  git("add", "-A");
  git("commit", "--quiet", "-m", "seed");
  const first = git("rev-parse", "--short", "HEAD").trim();

  for (const { path: p, content } of then) {
    mkdirSync(dirname(join(vault, p)), { recursive: true });
    writeFileSync(join(vault, p), content);
  }
  if (then.length) {
    git("add", "-A");
    git("commit", "--quiet", "-m", "later change");
  }
  return first;
}

function rules(report) {
  return [...report.errors, ...report.warnings].map((r) => r.rule);
}

const CASES = [
  ["missing-frontmatter", "missing-frontmatter"],
  ["missing-required-field", "missing-required-field"],
  ["unknown-type", "unknown-type"],
  ["meta-type-outside-knowledge-os", "meta-type-outside-knowledge-os"],
  ["unknown-lifecycle", "unknown-lifecycle"],
  ["invalid-status", "invalid-status"],
  ["unknown-evidence-level", "unknown-evidence-level"],
  ["unknown-priority", "unknown-priority"],
  ["missing-evidence-for-active", "missing-evidence-for-active"],
  ["below-evidence-floor", "below-evidence-floor"],
  ["active-scaffold", "active-scaffold"],
  ["unknown-relationship-field", "unknown-relationship-field"],
  ["broken-link", "broken-link"],
  ["ambiguous-basename-link", "ambiguous-basename-link"],
  ["blocking-uncertainty-on-active", "blocking-uncertainty-on-active"],
  ["invalid-yaml-frontmatter", "invalid-yaml-frontmatter"],
  ["unknown-metadata-key", "unknown-metadata-key"],
  ["unfilled-template-placeholder", "unfilled-template-placeholder"],
  ["project-type-inside-knowledge-os", "project-type-inside-knowledge-os"],
  ["claude-broken-link", "broken-link"],
  ["broken-base-folder", "broken-base-folder"],
  ["epic-status-behind-tasks", "epic-status-behind-tasks"],
  ["lifecycle-behind-status-epic", "lifecycle-behind-status"],
  ["lifecycle-behind-status-task", "lifecycle-behind-status"],
  ["lifecycle-behind-status-decision", "lifecycle-behind-status"],
  ["status-not-allowed-for-type", "status-not-allowed-for-type"],
  ["orphaned-note", "orphaned-note"],
  ["user-provided-not-allowed-for-architecture", "below-evidence-floor"],
  ["os-layer-outside-manifest", "os-layer-outside-manifest"],
  ["deployed-command-drift", "deployed-command-drift"],
  ["mvignore-excludes-os-layer", "mvignore-excludes-os-layer"],
  ["docs-broken-link", "broken-link"],
  ["evidence-not-allowed-for-type", "evidence-not-allowed-for-type"],
  ["epic-status-ahead-of-tasks", "epic-status-ahead-of-tasks"],
  ["scaffold", "scaffold"],
  ["path-link-wrong-folder", "broken-link"],
  ["list-item-relationship-field", "unknown-relationship-field"],
  ["task-type-case-insensitive", "lifecycle-behind-status"],
  ["undeployed-command-source", "undeployed-command-source"],
  ["invalid-metadata-value", "invalid-metadata-value"],
  ["broken-md-link", "broken-md-link"],
  ["docs-link-outside-os-layer", "docs-link-outside-os-layer"],
  ["undocumented-os-file", "undocumented-os-file"],
  ["invalid-config", "invalid-config"],
];

for (const [fixture, rule] of CASES) {
  test(`${fixture} fixture triggers ${rule}`, () => {
    const report = runFixture(fixture);
    assert.ok(
      rules(report).includes(rule),
      `expected \`${rule}\` among [${rules(report).join(", ")}] for fixture \`${fixture}\``
    );
  });
}

test("clean fixture passes with no violations", () => {
  const report = runFixture("clean");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* The negative half of lifecycle-behind-status and status-not-allowed-for-type:
 * an accepted Decision and a done Task that were promoted, a proposed Decision
 * that may stay draft, and an Architecture note with no status at all. A rule
 * that fired on the settled form would push every closing session red. */
test("lifecycle-behind-status-clean fixture triggers no false positive", () => {
  const report = runFixture("lifecycle-behind-status-clean");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* A5 regression: two notes share a basename ("Target") in different folders.
 * The blocking uncertainty links to one of them by full path; the other is
 * `active` but was never linked. Matching by basename alone (the pre-fix
 * behavior) would compare the link against every note named "Target.md" and
 * wrongly flag the unrelated active one. */
test("blocking-uncertainty-basename-collision fixture triggers no false positive", () => {
  const report = runFixture("blocking-uncertainty-basename-collision");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* The manifest is what delivery copies, so a file it does not name never
 * travels. `Knowledge-OS/Context Index.md` was outside it and the upstream
 * copy still carries sections D10 deleted here — a decision silently reverted.
 * A rule that fires on a complete manifest would be worse than none, so the
 * negative case matters as much as the positive one. */
/* Installing into a project that already has its own markdown is the ordinary
 * case, not an exotic one, and it used to fail loudly: the link rules ran on
 * every .md the walk reached, so a host project's memory bank produced an
 * error per unresolved link — twenty-five of them on the install that prompted
 * this — none of which said anything true. Those links resolve inside the
 * host's own graph, which this vault has never been shown.
 *
 * The fixture is that situation in miniature: a memory bank (nested, to prove
 * depth is not the escape), a docs/ file whose basename collides with a vault
 * note, a foreign .claude/agents/ file, and a deployed mv-* command whose link
 * into the vault is genuinely fine. Nothing here may be reported. The positive
 * half — that a broken link in a deployed mv-* command IS still caught — is
 * claude-broken-link, and both are needed: scoping a rule down is only correct
 * if it still fires where it was meant to. */
/* The negative half of deployed-command-drift: identical copies must say
 * nothing at all. A rule that fired on a correct deployment would be worse
 * than no rule, since every healthy install would carry a permanent finding. */
test("deployed-command-clean fixture triggers no false positive", () => {
  const report = runFixture("deployed-command-clean");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* Absence is a warning, not an error, and the distinction is what keeps the
 * upstream distribution repository — which has no `.claude/` at all, because
 * it is not an installed project — from failing its own validator. The host's
 * `their-tool.md` must also be ignored: it is outside the `mv-` namespace. */
test("deployed-command-missing warns without failing", () => {
  const report = runFixture("deployed-command-missing");
  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings.length, 1);
  assert.equal(report.warnings[0].rule, "deployed-command-missing");
});

/* The distribution copy is its own repository and has no `.claude/` by design.
 * It printed one deployed-command-missing per source — twelve on every clean
 * clone — a warning that is always on and so is never read. It is silent now
 * and says so once; an embedded vault with no `.claude/` still warns, because
 * there the project that should load the commands really lacks them. */
test("a standalone distribution copy with no .claude/ reports no deployed-command-missing", () => {
  const dropClaude = (vault) => rmSync(join(vault, ".claude"), { recursive: true, force: true });
  const standalone = runFixtureStandalone("deployed-command-missing", (vault) => {
    dropClaude(vault);
    execFileSync("git", ["init", "--quiet"], { cwd: vault });
  });
  assert.deepEqual(standalone.warnings, []);
  assert.equal(standalone.distributionCopy, true);

  const embedded = runFixture("deployed-command-missing", dropClaude);
  assert.deepEqual(
    embedded.warnings.map((w) => w.rule),
    ["deployed-command-missing"]
  );
});

/* A legitimate exclusion must be silent and visible at once: no findings
 * from the ignored tree, and the count of what was skipped printed with the
 * scan summary, so the suppression is auditable rather than invisible. */
test("mvignore-honored fixture excludes a foreign tree without complaint", () => {
  const report = runFixture("mvignore-honored");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* A line that matched nothing is the beginning of a file that no longer
 * describes the tree. A warning, not an error: it is stale, not dangerous. */
test("mvignore-line-unused warns about a line that matched nothing", () => {
  const report = runFixture("mvignore-line-unused");
  assert.deepEqual(report.errors, []);
  assert.equal(report.warnings.length, 1);
  assert.equal(report.warnings[0].rule, "mvignore-line-unused");
});

/* Docs/ is owned but not governed: a page needs no frontmatter, yet a note may
 * link into it and its own links resolve — the same standing as README.md. */
test("docs-link-target fixture: Docs needs no frontmatter and links into it resolve", () => {
  const report = runFixture("docs-link-target");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* A ledger row shown as an example inside a code fence is not a live row. */
test("uncertainty-example-in-code fixture triggers no false positive", () => {
  const report = runFixture("uncertainty-example-in-code");
  assert.deepEqual(report.errors, []);
});

/* `scaffold` is the warning half of active-scaffold: a draft that is only
 * headings is honest about being empty and must not fail the run. */
test("scaffold is a warning on a draft, not an error", () => {
  const report = runFixture("scaffold");
  assert.deepEqual(report.errors, []);
});

/* Every rule the validator can report must be exercised by some fixture. The
 * coverage test below only proves the converse — that every fixture has a
 * case — so a rule with no fixture at all could exist unnoticed, which is how
 * epic-status-ahead-of-tasks, scaffold and undeployed-command-source did. */
test("every rule the validator reports has a fixture case", () => {
  const source = readFileSync(VALIDATOR, "utf8");
  const ruleIds = new Set([...source.matchAll(/(?:err|warn)\(\s*[^,()]+,\s*"([a-z-]+)"/g)].map((m) => m[1]));
  const exercised = new Set([
    ...CASES.map(([, rule]) => rule),
    // exercised by dedicated tests rather than CASES
    "deployed-command-missing",
    "mvignore-line-unused",
    "stale-source",
  ]);
  const missing = [...ruleIds].filter((r) => !exercised.has(r)).sort();
  assert.deepEqual(missing, [], `rule(s) with no fixture: ${missing.join(", ")}`);
});

/* The vocabulary is validated before any note is: a misspelled type inside
 * statusByType used to switch status checking off for the type it meant. */
test("an invalid schema.json stops the run with the reason", () => {
  const root = mkdtempSync(join(tmpdir(), "mv-schema-"));
  try {
    mkdirSync(join(root, "Knowledge-OS", "Schema"), { recursive: true });
    mkdirSync(join(root, "Knowledge-OS", "Tools"), { recursive: true });
    const schema = JSON.parse(readFileSync(SCHEMA_JSON, "utf8"));
    schema.statusByType.tsak = schema.statusByType.task;
    writeFileSync(join(root, "Knowledge-OS", "Schema", "schema.json"), JSON.stringify(schema));
    cpSync(VALIDATOR, join(root, "Knowledge-OS", "Tools", "validate-vault.mjs"));
    withVendor(root);
    let status = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [join(root, "Knowledge-OS", "Tools", "validate-vault.mjs")], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      status = e.status;
      stderr = e.stderr;
    }
    assert.equal(status, 2);
    assert.match(stderr, /statusByType.*tsak/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* A settled status the type does not have would leave lifecycle-behind-status
 * unreachable for that type without a word — the failure loadSchema exists for. */
test("an activeLifecycleStatuses entry naming a status the type lacks stops the run", () => {
  const root = mkdtempSync(join(tmpdir(), "mv-schema-"));
  try {
    mkdirSync(join(root, "Knowledge-OS", "Schema"), { recursive: true });
    mkdirSync(join(root, "Knowledge-OS", "Tools"), { recursive: true });
    const schema = JSON.parse(readFileSync(SCHEMA_JSON, "utf8"));
    schema.activeLifecycleStatuses.decision = ["acepted"];
    writeFileSync(join(root, "Knowledge-OS", "Schema", "schema.json"), JSON.stringify(schema));
    cpSync(VALIDATOR, join(root, "Knowledge-OS", "Tools", "validate-vault.mjs"));
    withVendor(root);
    let status = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [join(root, "Knowledge-OS", "Tools", "validate-vault.mjs")], { encoding: "utf8", stdio: "pipe" });
    } catch (e) {
      status = e.status;
      stderr = e.stderr;
    }
    assert.equal(status, 2);
    assert.match(stderr, /activeLifecycleStatuses\.decision.*acepted/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("foreign-tree fixture reports nothing for files the vault does not own", () => {
  const report = runFixture("foreign-tree");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test("os-layer-manifest-complete fixture triggers no false positive", () => {
  const report = runFixture("os-layer-manifest-complete");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* Substitute the seeded commit into the fixture note's `source`, so the note
 * cites a hash that actually exists in the throwaway repository. */
function stampCommit(vault, commit) {
  const note = join(vault, "Project-OS", "Parser-Note.md");
  /* Quoted: a short SHA that happens to be all digits is parsed by YAML as a
   * number, and the rule then compares a number against a commit string and
   * fails for reasons having nothing to do with staleness. Came back from
   * upstream, where it was found the way intermittent failures usually are. */
  writeFileSync(note, readFileSync(note, "utf8").replace("__COMMIT__", JSON.stringify(commit)));
}

/* B8: the cited file moved after the note recorded its commit. This is the
 * case the rule exists for — and it must be a warning, because stale evidence
 * makes knowledge unverified rather than wrong. Failing the build over it is
 * how the `stale` frontmatter field died: a check nobody can live with gets
 * switched off, and then nothing is checked at all. */
test("stale-source warns when the cited file changed after the cited commit", () => {
  const report = runFixture("stale-source", (vault) => {
    const commit = withGitHistory(
      vault,
      [{ path: "src/thing.ts", content: "export const a = 1;\n" }],
      [{ path: "src/thing.ts", content: "export const a = 2;\n" }]
    );
    stampCommit(vault, commit);
  });

  assert.deepEqual(report.errors, []);
  const stale = report.warnings.filter((w) => w.rule === "stale-source");
  assert.equal(stale.length, 1, `expected one stale-source warning, got ${JSON.stringify(report.warnings)}`);
  assert.match(stale[0].message, /src\/thing\.ts/);
});

/* The same history with the later commit touching a different file. A rule
 * that fires here would fire on every note in a repository that keeps moving,
 * which is every repository. */
test("stale-source stays silent when the cited file is untouched", () => {
  const report = runFixture("stale-source-current", (vault) => {
    const commit = withGitHistory(
      vault,
      [{ path: "src/thing.ts", content: "export const a = 1;\n" }],
      [{ path: "src/other.ts", content: "export const b = 1;\n" }]
    );
    stampCommit(vault, commit);
  });

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* The cited file was never in the repository at all. `git log -- <path>`
 * answers "no commits" for such a path rather than failing, so before this
 * case existed a typo in `source.path` read exactly like current evidence. */
test("stale-source warns when the cited path never existed", () => {
  const report = runFixture("stale-source-current", (vault) => {
    const commit = withGitHistory(vault, [{ path: "src/other.ts", content: "export const b = 1;\n" }], []);
    stampCommit(vault, commit);
  });

  assert.deepEqual(report.errors, []);
  const stale = report.warnings.filter((w) => w.rule === "stale-source");
  assert.equal(stale.length, 1, `expected one stale-source warning, got ${JSON.stringify(report.warnings)}`);
  assert.match(stale[0].message, /src\/thing\.ts.*cannot resolve/);
});

/* Evidence Schema states the Product rule as "`user-provided` or `L4`", but
 * `user-provided` is not a rung on the L1→L4 ladder and cannot be compared by
 * index against it. Before `evidenceAlternativeByType` only the L4 half was
 * enforceable, which left Product notes stating the owner's own intent stuck
 * in draft behind a confirmation that would have graded nothing. */
test("user-provided satisfies the Product evidence floor", () => {
  const report = runFixture("product-user-provided-evidence");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* orphaned-note must be a warning, never an error. On a real vault it fires on
 * notes that are merely young — a Finding written this session has no inbound
 * link yet — and an error there would make the validator red for a condition
 * nobody should rush to fix. A normally-red validator stops being read. */
test("orphaned-note is reported as a warning, not an error", () => {
  const report = runFixture("orphaned-note");
  assert.deepEqual(report.errors, []);
  assert.ok(
    report.warnings.some((w) => w.rule === "orphaned-note"),
    `expected an orphaned-note warning, got [${report.warnings.map((w) => w.rule).join(", ")}]`
  );
});

/* The exemption that keeps the rule honest: a note something links to is
 * reachable, and a meta type is an entry point by construction. Without this
 * the rule would fire on every healthy vault, and demanding an inbound link
 * for every README and rule would produce a link graph built to satisfy a
 * validator rather than to be navigated. */
test("orphaned-note-linked fixture triggers no false positive", () => {
  const report = runFixture("orphaned-note-linked");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* An Epic with one Task still open is healthy, not behind. The derived-status
 * rule has to distinguish "every Task finished" from "some Task finished", or
 * it fires on every Epic the moment the first Task closes and the reader
 * learns to skip it. */
test("epic-status-open-tasks fixture triggers no false positive", () => {
  const report = runFixture("epic-status-open-tasks");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* Finding is the one entity type whose template starts lifecycle: active
 * instead of draft (Knowledge Types: it never sits in draft waiting on
 * promotion). Its template deliberately omits evidence, so inserting it
 * outside /mv-note must fail missing-evidence-for-active and nothing else —
 * this is Evidence Schema working as designed, not a bug to silence with a
 * default value. */
test("finding template without evidence triggers only missing-evidence-for-active", () => {
  const report = runFixture("finding-template-requires-evidence");
  assert.deepEqual(report.warnings, []);
  assert.equal(report.errors.length, 1);
  assert.equal(report.errors[0].rule, "missing-evidence-for-active");
});

/* stale-source, asked in the layout where the vault is its own repository.
 * The rule shells out to git with the repository root it derived; if that root
 * is wrong, the command runs against a directory that never tracked the file,
 * and the answer degrades to "cannot resolve" — silently reading as clean.
 * Upstream is exactly this shape, so the rule has been answering for the wrong
 * repository there. Both directions are asserted: a moved file must warn, and
 * an untouched one must stay quiet. */
test("stale-source works when the vault is its own repository root", () => {
  const report = runFixtureStandalone("stale-source", (vault) => {
    const commit = withGitHistoryStandalone(
      vault,
      [{ path: "src/thing.ts", content: "export const a = 1;\n" }],
      [{ path: "src/thing.ts", content: "export const a = 2;\n" }]
    );
    stampCommit(vault, commit);
  });
  const stale = report.warnings.filter((w) => w.rule === "stale-source");
  assert.equal(stale.length, 1, "the citation must be recognised as stale in this layout too");
  assert.match(stale[0].message, /src\/thing\.ts/);
});

/* Backlog 2026-09-17: a vault with its own .git inside the project. The
 * search for a repository stopped at the vault's own, which never held the
 * project's code, so every `source` read as unresolvable. The personal
 * install recommends exactly this layout, and its install record names the
 * project root; with the record the project's repository answers. */
test("with an install record, a vault with its own .git asks the project's repository", () => {
  const prepare = (withRecord) => (vault) => {
    const commit = withGitHistory(
      vault,
      [{ path: "src/thing.ts", content: "export const a = 1;\n" }],
      [{ path: "src/other.ts", content: "export const b = 1;\n" }]
    );
    stampCommit(vault, commit);
    execFileSync("git", ["init", "--quiet"], { cwd: vault });
    if (withRecord) {
      mkdirSync(join(vault, ".mvos"), { recursive: true });
      writeFileSync(join(vault, ".mvos", "install.json"), JSON.stringify({ format: 1, mode: "local", projectRoot: ".." }));
    }
  };
  const without = runFixture("stale-source-current", prepare(false));
  assert.ok(
    without.warnings.some((w) => w.rule === "stale-source" && /cannot resolve/.test(w.message)),
    "without a record the vault's own repository is asked, and cannot answer"
  );
  const withRecord = runFixture("stale-source-current", prepare(true));
  assert.deepEqual(withRecord.warnings.filter((w) => w.rule === "stale-source"), []);
  assert.equal(withRecord.installMode, "local");
});

test("stale-source stays silent in the standalone layout when nothing moved", () => {
  const report = runFixtureStandalone("stale-source-current", (vault) => {
    const commit = withGitHistoryStandalone(
      vault,
      [{ path: "src/thing.ts", content: "export const a = 1;\n" }],
      [{ path: "src/other.ts", content: "export const b = 1;\n" }]
    );
    stampCommit(vault, commit);
  });
  assert.deepEqual(
    report.warnings.filter((w) => w.rule === "stale-source"),
    []
  );
});

/* The three rules of the definition of done (Docs/10-Extending.md) fire once
 * on their own fixture and on nothing else in it. */
for (const rule of ["broken-md-link", "docs-link-outside-os-layer", "undocumented-os-file", "invalid-config"]) {
  test(`${rule} fixture reports exactly that one error`, () => {
    const report = runFixture(rule);
    assert.deepEqual(report.warnings, []);
    assert.deepEqual(
      report.errors.map((e) => e.rule),
      [rule],
      JSON.stringify(report.errors)
    );
  });
}

/* Every legitimate form of Markdown link must pass: relative, up a level, from
 * the vault root, with an anchor, `<…>` and percent-encoded spaces, an image,
 * a URL, an anchor alone — and a link shown as code is no link. Plans/ keeps
 * the editor-style links it was written with. A rule that fired on any of
 * these would teach its reader to stop writing links. */
test("md-link-clean fixture triggers no false positive", () => {
  const report = runFixture("md-link-clean");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* What Docs/ may point at: a manifest path, a manifest-covered root file, a
 * per-copy file, a template excluded from delivery (every copy has its own),
 * another page. */
test("docs-link-inside-os-layer fixture triggers no false positive", () => {
  const report = runFixture("docs-link-inside-os-layer");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* Every kind of OS file named the way a page names it — a tool by file name, a
 * command as /mv-x, a hook and a Dist file by name — and test files not
 * required at all. */
/* Every key the config knows, each with a value it accepts — a region tag
 * included, since a language tag is more than two letters. */
test("config-clean fixture triggers no false positive", () => {
  const report = runFixture("config-clean");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test("undocumented-os-file-clean fixture triggers no false positive", () => {
  const report = runFixture("undocumented-os-file-clean");
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

/* The rule table in Docs/06-1 is the documentation of the validator: a rule
 * missing from it is a rule a reader cannot look up, and a row for a rule
 * that no longer exists describes a check nobody runs. Both directions. */
test("every rule the validator reports has a row in the Docs/06-1 rule table", () => {
  const source = readFileSync(VALIDATOR, "utf8");
  const ruleIds = new Set([...source.matchAll(/(?:err|warn)\(\s*[^,()]+,\s*"([a-z-]+)"/g)].map((m) => m[1]));
  // Its first argument holds parentheses, which the pattern above cannot see past.
  ruleIds.add("undeployed-command-source");
  const page = readFileSync(join(HERE, "..", "..", "Docs", "06-Tooling", "06-1-Validator.md"), "utf8");
  const rows = new Set([...page.matchAll(/^\| `([a-z-]+)` \| (?:error|warning) \|/gm)].map((m) => m[1]));
  const undocumented = [...ruleIds].filter((r) => !rows.has(r)).sort();
  const stale = [...rows].filter((r) => !ruleIds.has(r)).sort();
  assert.deepEqual(undocumented, [], `rule(s) with no row in Docs/06-1: ${undocumented.join(", ")}`);
  assert.deepEqual(stale, [], `row(s) in Docs/06-1 for no rule: ${stale.join(", ")}`);
});

test("every fixture directory under __fixtures__ is covered by a case", () => {
  const covered = new Set([
    ...CASES.map(([f]) => f),
    "clean",
    "blocking-uncertainty-basename-collision",
    "finding-template-requires-evidence",
    "epic-status-open-tasks",
    "lifecycle-behind-status-clean",
    "orphaned-note-linked",
    "product-user-provided-evidence",
    "stale-source",
    "stale-source-current",
    "os-layer-manifest-complete",
    "foreign-tree",
    "docs-link-target",
    "uncertainty-example-in-code",
    "deployed-command-clean",
    "deployed-command-missing",
    "mvignore-honored",
    "mvignore-line-unused",
    "md-link-clean",
    "docs-link-inside-os-layer",
    "undocumented-os-file-clean",
    "config-clean",
  ]);
  const present = readdirSync(FIXTURES).filter((f) => statSync(join(FIXTURES, f)).isDirectory());
  const uncovered = present.filter((f) => !covered.has(f));
  assert.deepEqual(uncovered, [], `fixture(s) with no test case: ${uncovered.join(", ")}`);
});
