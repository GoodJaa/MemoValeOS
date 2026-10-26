/**
 * Tests for os-check.mjs.
 *
 * Most of the tool delegates to other tools that have their own tests. What is
 * its own is the docs-with-code rule: which paths count as code, what counts as
 * a waiver, when CHANGELOG.md is owed. Those are tested as a pure function, and
 * then once through real git in both layouts the tool supports — the vault
 * inside a project, and the vault as its own repository root — because the
 * paths git reports are where a layout difference would bite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { checkDocsWithCode, isCodePath } from "./os-check.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const commit = (files, message = "change") => ({ sha: "abcdef1234567", subject: message.split("\n")[0], message, files });

test("which paths count as code", () => {
  for (const p of [
    "Knowledge-OS/Tools/adopt.mjs",
    "Knowledge-OS/Dist/commands/mv-check.md",
    "Knowledge-OS/Schema/schema.json",
    "Knowledge-OS/Rules/AI-Governance.md",
    "Knowledge-OS/Protocols/Deployment-Protocol.md",
  ])
    assert.ok(isCodePath(p), p);
  for (const p of [
    "Knowledge-OS/Tools/adopt.test.mjs",
    "Knowledge-OS/Tools/__fixtures__/broken-link/Project-OS/Note.md",
    "Knowledge-OS/Tools/__provider_fixtures__/basic/CLAUDE.md",
    "Knowledge-OS/README.md",
    "Docs/10-Extending.md",
    "Project-OS/06-AI/AI.md",
    "CHANGELOG.md",
  ])
    assert.ok(!isCodePath(p), p);
});

test("code without Docs/ and without a waiver is a problem", () => {
  const { problems } = checkDocsWithCode([commit(["Knowledge-OS/Tools/adopt.mjs", "CHANGELOG.md"])]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /adopt\.mjs but not Docs\//);
});

test("code with Docs/ and CHANGELOG.md is done", () => {
  const r = checkDocsWithCode([commit(["Knowledge-OS/Tools/adopt.mjs", "Docs/08-Distribution/08-2-Adoption.md", "CHANGELOG.md"])]);
  assert.deepEqual(r, { codeCommits: 1, problems: [] });
});

test("a waiver must give a reason", () => {
  const withReason = commit(["Knowledge-OS/Tools/adopt.mjs", "CHANGELOG.md"], "Rename a local\n\nDocs: none — internal rename, no behaviour");
  assert.deepEqual(checkDocsWithCode([withReason]).problems, []);
  const bare = commit(["Knowledge-OS/Tools/adopt.mjs", "CHANGELOG.md"], "Rename a local\n\nDocs: none");
  assert.equal(checkDocsWithCode([bare]).problems.length, 1);
});

test("CHANGELOG.md may come in another commit of the range, but must come", () => {
  const code = commit(["Knowledge-OS/Tools/adopt.mjs", "Docs/08-Distribution/08-2-Adoption.md"]);
  assert.equal(checkDocsWithCode([code]).problems.length, 1);
  assert.match(checkDocsWithCode([code]).problems[0], /CHANGELOG\.md/);
  assert.deepEqual(checkDocsWithCode([code, commit(["CHANGELOG.md"])]).problems, []);
});

test("a range that never touches the OS layer owes nothing", () => {
  const r = checkDocsWithCode([commit(["Project-OS/03-Development/Tasks/T01.md"]), commit(["Knowledge-OS/Tools/adopt.test.mjs"])]);
  assert.deepEqual(r, { codeCommits: 0, problems: [] });
});

/* Real git: the range and the vault-relative paths. `vaultDir` is "" when the
 * vault is the repository root. */
function withRepo(vaultDir, commits, fn) {
  const root = mkdtempSync(join(tmpdir(), "mv-os-check-"));
  const vault = vaultDir ? join(root, vaultDir) : root;
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const write = (rel, content) => {
    const p = join(vault, rel.split("/").join(sep));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  try {
    git("init", "--quiet");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    git("config", "commit.gpgsign", "false");
    write("README.md", "seed\n");
    if (vaultDir) writeFileSync(join(root, "app.js"), "seed\n");
    git("add", "-A");
    git("commit", "--quiet", "-m", "seed");
    const base = git("rev-parse", "HEAD").trim();
    for (const [i, { files, outside = [], message }] of commits.entries()) {
      for (const f of files) write(f, `change ${i}\n`);
      for (const f of outside) writeFileSync(join(root, f), `change ${i}\n`);
      git("add", "-A");
      git("commit", "--quiet", "-m", message);
    }
    mkdirSync(join(vault, "Knowledge-OS", "Tools"), { recursive: true });
    cpSync(join(HERE, "os-check.mjs"), join(vault, "Knowledge-OS", "Tools", "os-check.mjs"));
    const r = spawnSync(
      process.execPath,
      [
        join(vault, "Knowledge-OS", "Tools", "os-check.mjs"),
        "--skip",
        "validate-vault,tests,syntax,deployment,graph",
        "--range",
        `${base}..HEAD`,
      ],
      { encoding: "utf8" }
    );
    fn(r.status, r.stdout + r.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const [layout, vaultDir] of [
  ["embedded", "MemoValeOS"],
  ["standalone", ""],
]) {
  test(`${layout}: a range with code, Docs/ and CHANGELOG.md passes`, () => {
    withRepo(
      vaultDir,
      [
        { files: ["Knowledge-OS/Tools/thing.mjs", "Docs/06-Tooling/thing.md"], message: "Add a thing" },
        { files: ["CHANGELOG.md"], message: "Record the thing" },
      ],
      (status, out) => {
        assert.equal(status, 0, out);
        assert.match(out, /2 commit\(s\), 1 change the OS layer/);
      }
    );
  });

  test(`${layout}: code without Docs/ fails and names the commit`, () => {
    withRepo(vaultDir, [{ files: ["Knowledge-OS/Tools/thing.mjs", "CHANGELOG.md"], message: "Undocumented thing" }], (status, out) => {
      assert.equal(status, 1, out);
      assert.match(out, /"Undocumented thing" changes Knowledge-OS\/Tools\/thing\.mjs but not Docs\//);
    });
  });
}

test("embedded: commits outside the vault are not the vault's business", () => {
  withRepo(
    "MemoValeOS",
    [
      { files: [], outside: ["app.js"], message: "host code only" },
      { files: ["Docs/x.md"], message: "vault docs only" },
    ],
    (status, out) => {
      assert.equal(status, 0, out);
      assert.match(out, /1 commit\(s\), 0 change the OS layer/);
    }
  );
});

test("an unknown step name for --skip exits 1 before running anything", () => {
  const r = spawnSync(process.execPath, [join(HERE, "os-check.mjs"), "--skip", "no-such-step"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown step/);
});
