/**
 * Tests for upgrade.mjs.
 *
 * The script replaces files in a project that has its own knowledge next to
 * the OS layer, so the cases that matter are its refusals: a dirty tree, and a
 * ref whose diff reaches past the manifest. The one positive case checks that
 * a refusal is not all it can do — and, in the embedded layout, that a change
 * outside the vault altogether is not mistaken for a change to the vault.
 *
 * Each case builds a real repository with the script committed inside it (an
 * untracked copy would make the tree dirty, which the script rightly refuses),
 * a second branch standing in for the upstream ref, and runs the script with
 * `--yes` so no prompt is needed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = ["Knowledge-OS/Rules/**", "Knowledge-OS/os-manifest", "Project-OS/Templates/*.md", "!Project-OS/Templates/Task.md"].join("\n") + "\n";

/* `vaultDir` is "" for the standalone layout (the repository is the vault) and
 * a folder name for the embedded one. */
function makeRepo(vaultDir) {
  const root = mkdtempSync(join(tmpdir(), "mv-upgrade-"));
  const vault = vaultDir ? join(root, vaultDir) : root;
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const write = (rel, content) => {
    const p = join(root, rel.split("/").join(sep));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  const v = (rel) => (vaultDir ? `${vaultDir}/${rel}` : rel);
  git("init", "--quiet");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");

  write(v("Knowledge-OS/os-manifest"), MANIFEST);
  write(v("Knowledge-OS/Rules/Rule.md"), "rule v1\n");
  write(v("Project-OS/Templates/Epic.md"), "epic template v1\n");
  write(v("Project-OS/Templates/Task.md"), "this project's own task template\n");
  write(v("Project-OS/Home.md"), "this project's home\n");
  mkdirSync(join(vault, "Knowledge-OS", "Tools"), { recursive: true });
  cpSync(join(HERE, "upgrade.mjs"), join(vault, "Knowledge-OS", "Tools", "upgrade.mjs"));
  git("add", "-A");
  git("commit", "--quiet", "-m", "base");
  return { root, vault, git, write, v };
}

/* An "upstream" branch with the given changes; the working branch stays checked out. */
function upstreamRef(repo, change) {
  const { git } = repo;
  const main = git("rev-parse", "--abbrev-ref", "HEAD").trim();
  git("checkout", "--quiet", "-b", "upstream");
  change(repo);
  git("add", "-A");
  git("commit", "--quiet", "-m", "upstream");
  git("checkout", "--quiet", main);
}

function upgrade(vault, args) {
  try {
    const out = execFileSync("node", [join(vault, "Knowledge-OS", "Tools", "upgrade.mjs"), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

const read = (root, rel) => readFileSync(join(root, rel.split("/").join(sep)), "utf8");

test("only manifest paths are taken from the ref, and an excluded template is left alone", () => {
  const repo = makeRepo("");
  try {
    upstreamRef(repo, ({ write }) => {
      write("Knowledge-OS/Rules/Rule.md", "rule v2\n");
      write("Project-OS/Templates/Epic.md", "epic template v2\n");
    });
    const result = upgrade(repo.vault, ["upstream", "--yes"]);
    assert.equal(result.code, 0, result.out);
    assert.equal(read(repo.root, "Knowledge-OS/Rules/Rule.md"), "rule v2\n");
    assert.equal(read(repo.root, "Project-OS/Templates/Epic.md"), "epic template v2\n");
    assert.equal(read(repo.root, "Project-OS/Templates/Task.md"), "this project's own task template\n");
    assert.equal(read(repo.root, "Project-OS/Home.md"), "this project's home\n");
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("a ref that differs outside the manifest is refused, and nothing is written", () => {
  const repo = makeRepo("");
  try {
    upstreamRef(repo, ({ write }) => {
      write("Knowledge-OS/Rules/Rule.md", "rule v2\n");
      write("Project-OS/Home.md", "upstream's template home\n");
      write("Project-OS/Templates/Task.md", "upstream's shorter task template\n");
    });
    const result = upgrade(repo.vault, ["upstream", "--yes"]);
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /outside os-manifest[\s\S]*Project-OS\/Home\.md/);
    assert.match(result.out, /Project-OS\/Templates\/Task\.md/, "an excluded path counts as outside");
    assert.equal(read(repo.root, "Knowledge-OS/Rules/Rule.md"), "rule v1\n");
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("a dirty working tree is refused", () => {
  const repo = makeRepo("");
  try {
    upstreamRef(repo, ({ write }) => write("Knowledge-OS/Rules/Rule.md", "rule v2\n"));
    repo.write("Knowledge-OS/Rules/Rule.md", "a local edit nobody committed\n");
    const result = upgrade(repo.vault, ["upstream", "--yes"]);
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /not clean/);
    assert.equal(read(repo.root, "Knowledge-OS/Rules/Rule.md"), "a local edit nobody committed\n");
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("in the embedded layout, project code outside the vault is neither taken nor counted", () => {
  const repo = makeRepo("MemoValeOS");
  try {
    repo.write("src/app.ts", "export const app = 1;\n");
    repo.git("add", "-A");
    repo.git("commit", "--quiet", "-m", "project code");
    upstreamRef(repo, ({ write }) => {
      write("MemoValeOS/Knowledge-OS/Rules/Rule.md", "rule v2\n");
      write("src/app.ts", "export const app = 2;\n");
    });
    const result = upgrade(repo.vault, ["upstream", "--yes"]);
    assert.equal(result.code, 0, result.out);
    assert.equal(read(repo.root, "MemoValeOS/Knowledge-OS/Rules/Rule.md"), "rule v2\n");
    assert.equal(read(repo.root, "src/app.ts"), "export const app = 1;\n");
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

/* A NUL byte anywhere in a file makes git treat it as binary: no line diff, no
 * three-way merge, and a change on both sides of a sync becomes a whole-file
 * conflict. upgrade.mjs carried four of them for a month, as a glob sentinel. */
test("no tool source contains a NUL byte", () => {
  const offenders = readdirSync(HERE)
    .filter((f) => f.endsWith(".mjs"))
    .filter((f) => readFileSync(join(HERE, f)).includes(0));
  assert.deepEqual(offenders, []);
});
