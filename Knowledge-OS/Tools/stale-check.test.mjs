/**
 * Tests for stale-check.mjs.
 *
 * The tool's whole value is the difference between three answers that look
 * alike from outside: the cited file moved (stale), the citation cannot be
 * asked about (unknown commit, or a path that is not there), and nothing
 * happened. Each case is a real repository with a two-commit history, in both
 * layouts the tool supports — the vault inside a project, and the vault as
 * its own repository root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, existsSync, symlinkSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/* stale-check imports js-yaml; where it lives depends on how the repository
 * was installed (see validate-vault.test.mjs for the history). */
const NODE_MODULES = [join(HERE, "..", "..", "node_modules"), join(HERE, "..", "..", "..", "node_modules")].find((p) =>
  existsSync(join(p, "js-yaml"))
);
if (!NODE_MODULES) throw new Error("js-yaml not found. Run `npm install` at the repository root.");

/* `vaultDir` is "" when the vault is the repository root. Notes are written
 * after the history, with `__COMMIT__` replaced by the first commit's hash. */
function withHistory(vaultDir, { seed, then, notes }, fn) {
  const root = mkdtempSync(join(tmpdir(), "mv-stale-"));
  const vault = vaultDir ? join(root, vaultDir) : root;
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const write = (rel, content) => {
    const p = join(root, rel.split("/").join(sep));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  try {
    git("init", "--quiet");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    git("config", "commit.gpgsign", "false");
    for (const [p, c] of Object.entries(seed)) write(p, c);
    git("add", "-A");
    git("commit", "--quiet", "-m", "seed");
    const first = git("rev-parse", "--short", "HEAD").trim();
    for (const [p, c] of Object.entries(then)) write(p, c);
    git("add", "-A");
    git("commit", "--quiet", "--allow-empty", "-m", "later");

    const v = (rel) => (vaultDir ? `${vaultDir}/${rel}` : rel);
    // Quoted: an all-digit short hash would otherwise be read as a YAML number.
    for (const [p, c] of Object.entries(notes)) write(v(p), c.replaceAll("__COMMIT__", `"${first}"`));
    mkdirSync(join(vault, "Knowledge-OS", "Tools"), { recursive: true });
    cpSync(join(HERE, "stale-check.mjs"), join(vault, "Knowledge-OS", "Tools", "stale-check.mjs"));
    symlinkSync(NODE_MODULES, join(vault, "node_modules"), "junction");

    const out = execFileSync("node", [join(vault, "Knowledge-OS", "Tools", "stale-check.mjs"), "--json"], { encoding: "utf8" });
    fn(JSON.parse(out).findings);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const cites = (path, commit = "__COMMIT__") =>
  `---\ntype: architecture\nlifecycle: active\nsource:\n  - path: ${path}\n    commit: ${commit}\n---\n\n# Note\n`;

for (const [layout, vaultDir, codePath] of [
  ["embedded", "MemoValeOS", "src/thing.ts"],
  ["standalone", "", "src/thing.ts"],
]) {
  test(`${layout}: a cited file changed after the cited commit is stale, an untouched one is not`, () => {
    withHistory(
      vaultDir,
      {
        seed: { [codePath]: "export const a = 1;\n", "src/other.ts": "export const b = 1;\n" },
        then: { [codePath]: "export const a = 2;\n" },
        notes: { "Project-OS/Moved.md": cites(codePath), "Project-OS/Current.md": cites("src/other.ts") },
      },
      (findings) => {
        assert.equal(findings.length, 1, JSON.stringify(findings));
        assert.equal(findings[0].kind, "stale");
        assert.equal(findings[0].path, codePath);
        assert.equal(findings[0].commits.length, 1);
        assert.match(findings[0].note, /Moved\.md$/);
      }
    );
  });

  test(`${layout}: a path that never existed is reported, not read as current`, () => {
    withHistory(
      vaultDir,
      {
        seed: { "src/other.ts": "export const b = 1;\n" },
        then: {},
        notes: { "Project-OS/Typo.md": cites("src/othr.ts") },
      },
      (findings) => {
        assert.equal(findings.length, 1, JSON.stringify(findings));
        assert.equal(findings[0].kind, "untracked-path");
      }
    );
  });
}

test("a commit the repository does not have is reported as unknown", () => {
  withHistory(
    "",
    {
      seed: { "src/thing.ts": "export const a = 1;\n" },
      then: {},
      notes: { "Project-OS/Foreign.md": cites("src/thing.ts", '"deadbee"') },
    },
    (findings) => {
      assert.equal(findings.length, 1, JSON.stringify(findings));
      assert.equal(findings[0].kind, "unknown-commit");
    }
  );
});

test("templates and Dist are not checked, even when they carry a source", () => {
  withHistory(
    "",
    {
      seed: { "src/thing.ts": "export const a = 1;\n" },
      then: { "src/thing.ts": "export const a = 2;\n" },
      notes: {
        "Project-OS/Templates/Architecture.md": cites("src/thing.ts"),
        "Knowledge-OS/Dist/commands/mv-x.md": cites("src/thing.ts"),
      },
    },
    (findings) => assert.deepEqual(findings, [])
  );
});
