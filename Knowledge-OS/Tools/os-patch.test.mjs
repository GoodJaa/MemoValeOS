/**
 * Tests for os-patch.mjs.
 *
 * Delivery by subtree split published the host project's whole vault history
 * upstream. os-patch carries only the OS layer's changes, as a patch, so these
 * tests pin what must and must not be in it — a project note or a source file
 * in the patch is the leak this tool exists to end — and that the result
 * applies three-way to a copy that has its own Project-OS.
 *
 * The integration cases build a real host repository with the vault one level
 * down (`V/`), tag a base, change it, and apply the patch to a standalone
 * "upstream" repository holding the base's OS layer at its root.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { parseNameStatusZ, selectOsPaths } from "./os-patch.mjs";
import { compileManifest } from "./manifest.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/* ------------------------------------------------------------ pure parts */

test("name-status records pair a status with a path, spaces and Cyrillic intact", () => {
  assert.deepEqual(parseNameStatusZ("M\0V/Knowledge-OS/Rules/A.md\0D\0V/Docs/Старое имя.md\0"), [
    { status: "M", path: "V/Knowledge-OS/Rules/A.md" },
    { status: "D", path: "V/Docs/Старое имя.md" },
  ]);
});

test("only paths a manifest names, inside the vault, are selected", () => {
  const toVault = (p) => (p.startsWith("V/") ? p.slice(2) : null);
  const entries = parseNameStatusZ(
    ["M", "V/Knowledge-OS/Rules/A.md", "M", "V/Project-OS/Tasks/T01.md", "M", "src/index.ts", "D", "V/Knowledge-OS/Old.base", ""].join("\0")
  );
  const before = compileManifest("Knowledge-OS/Rules/**\nKnowledge-OS/Old.base\n");
  const after = compileManifest("Knowledge-OS/Rules/**\nKnowledge-OS/New.base\n");
  assert.deepEqual(
    selectOsPaths(entries, toVault, [before, after]).map((e) => e.path),
    ["V/Knowledge-OS/Rules/A.md", "V/Knowledge-OS/Old.base"]
  );
});

/* ----------------------------------------------------------- integration */

function makeRepo(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const write = (rel, content) => {
    const p = join(root, rel.split("/").join(sep));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  git("init", "--quiet");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Fixture");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  return { root, git, write };
}

const commitAll = (git, message) => {
  git("add", "-A");
  git("commit", "--quiet", "-m", message);
};

const BASE = {
  "Knowledge-OS/os-manifest": "Knowledge-OS/os-manifest\nKnowledge-OS/Rules/**\nKnowledge-OS/Old.base\n",
  "Knowledge-OS/Rules/Rule.md": "rule v1\n",
  "Knowledge-OS/Rules/Gone.md": "a rule that will be removed\n",
  "Knowledge-OS/Old.base": "views: []\n",
};

/* A host with the vault under V/, its own project knowledge and source code,
 * tagged at the base and then changed in every way a delivery has to carry. */
function hostAfterChanges() {
  const host = makeRepo("mv-patch-host-");
  for (const [p, c] of Object.entries(BASE)) host.write(`V/${p}`, c);
  host.write("V/Project-OS/Tasks/T01.md", "the host's own task\n");
  host.write("src/index.ts", "export {};\n");
  commitAll(host.git, "base");
  host.git("tag", "os-v1");

  host.write("V/Knowledge-OS/Rules/Rule.md", "rule v2\n");
  host.write("V/Knowledge-OS/Rules/New.md", "a new rule\n");
  rmSync(join(host.root, "V", "Knowledge-OS", "Rules", "Gone.md"));
  rmSync(join(host.root, "V", "Knowledge-OS", "Old.base"));
  host.write("V/Knowledge-OS/New.base", "views: []\n");
  host.write("V/Knowledge-OS/os-manifest", "Knowledge-OS/os-manifest\nKnowledge-OS/Rules/**\nKnowledge-OS/New.base\n");
  host.write("V/Project-OS/Tasks/T01.md", "the host's own task, now done\n");
  host.write("src/index.ts", "export const x = 1;\n");
  commitAll(host.git, "work");

  // The tool finds its vault from its own location, as it does in a real host.
  mkdirSync(join(host.root, "V", "Knowledge-OS", "Tools"), { recursive: true });
  for (const f of ["os-patch.mjs", "manifest.mjs"]) cpSync(join(HERE, f), join(host.root, "V", "Knowledge-OS", "Tools", f));
  return host;
}

function runPatch(host, out) {
  return execFileSync(process.execPath, [join(host.root, "V", "Knowledge-OS", "Tools", "os-patch.mjs"), "--since", "os-v1", "--out", out], {
    cwd: host.root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("the patch carries the OS layer only — no project note, no source file", () => {
  const host = hostAfterChanges();
  const out = join(host.root, "os.patch");
  try {
    runPatch(host, out);
    const patch = readFileSync(out, "utf8");
    assert.match(patch, /^diff --git a\/Knowledge-OS\/Rules\/Rule\.md b\/Knowledge-OS\/Rules\/Rule\.md$/m, "paths are vault-relative");
    assert.doesNotMatch(patch, /Project-OS|src\/index\.ts|the host's own task/);
    // Renamed out of the manifest: deleted, because the old manifest named it.
    assert.match(patch, /^deleted file mode .*\n.*\n--- a\/Knowledge-OS\/Old\.base$/m);
  } finally {
    rmSync(host.root, { recursive: true, force: true });
  }
});

test("the patch applies three-way to a standalone copy that keeps its own Project-OS", () => {
  const host = hostAfterChanges();
  const upstream = makeRepo("mv-patch-upstream-");
  const out = join(host.root, "os.patch");
  try {
    for (const [p, c] of Object.entries(BASE)) upstream.write(p, c);
    upstream.write("Project-OS/Tasks/.gitkeep", "");
    upstream.write("README.md", "upstream's own README\n");
    commitAll(upstream.git, "upstream at os-v1");

    runPatch(host, out);
    upstream.git("apply", "--3way", "--index", out);

    const read = (p) => readFileSync(join(upstream.root, p), "utf8");
    assert.equal(read("Knowledge-OS/Rules/Rule.md"), "rule v2\n");
    assert.equal(read("Knowledge-OS/Rules/New.md"), "a new rule\n");
    assert.equal(existsSync(join(upstream.root, "Knowledge-OS", "Rules", "Gone.md")), false);
    assert.equal(existsSync(join(upstream.root, "Knowledge-OS", "Old.base")), false);
    assert.equal(read("Knowledge-OS/New.base"), "views: []\n");
    assert.equal(read("README.md"), "upstream's own README\n");
    assert.equal(existsSync(join(upstream.root, "Project-OS", "Tasks", "T01.md")), false);
  } finally {
    rmSync(host.root, { recursive: true, force: true });
    rmSync(upstream.root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------- a copy without history */

/* Upstream tagged at the copy's version, then moved on. */
function upstreamMovedOn() {
  const upstream = makeRepo("mv-patch-up-");
  for (const [p, c] of Object.entries(BASE)) upstream.write(p, c);
  upstream.write("README.md", "upstream's own README\n");
  commitAll(upstream.git, "os-v1");
  upstream.git("tag", "os-v1");
  upstream.write("Knowledge-OS/Rules/Upstream-Only.md", "added upstream after os-v1\n");
  upstream.write("Knowledge-OS/Old.base", "views: [later]\n");
  commitAll(upstream.git, "after os-v1");
  return upstream;
}

/* A copy installed at os-v1 with no git at all — the vault's .git deleted, as
 * on the first real installation — and changed on disk, on Windows with CRLF. */
function copyWithoutHistory(version = "os-v1\n") {
  const root = mkdtempSync(join(tmpdir(), "mv-patch-copy-"));
  const write = (rel, content) => {
    const p = join(root, rel.split("/").join(sep));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  };
  for (const [p, c] of Object.entries(BASE)) write(p, c);
  if (version !== null) write(".os-version", version);
  write("Knowledge-OS/Rules/Rule.md", "rule v2 from the copy\r\n");
  write("Knowledge-OS/Rules/New.md", "a rule the copy added\n");
  rmSync(join(root, "Knowledge-OS", "Rules", "Gone.md"));
  write("Knowledge-OS/Rules/Rule.md.mvos-new", "left by an upgrade conflict\n");
  write("Project-OS/Tasks/T01.md", "the copy's own task\n");
  mkdirSync(join(root, "Knowledge-OS", "Tools"), { recursive: true });
  for (const f of ["os-patch.mjs", "manifest.mjs"]) cpSync(join(HERE, f), join(root, "Knowledge-OS", "Tools", f));
  return root;
}

function runAgainst(copy, args) {
  try {
    const stderr = execFileSync(process.execPath, [join(copy, "Knowledge-OS", "Tools", "os-patch.mjs"), ...args], { cwd: copy, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { status: 0, stderr };
  } catch (e) {
    return { status: e.status, stderr: e.stderr };
  }
}

test("--against: a copy with no history delivers its own changes, and upstream keeps what came after", () => {
  const upstream = upstreamMovedOn();
  const copy = copyWithoutHistory();
  const out = join(copy, "os.patch");
  try {
    const r = runAgainst(copy, ["--against", upstream.root, "--out", out]);
    assert.equal(r.status, 0, r.stderr);
    const patch = readFileSync(out, "utf8");
    assert.doesNotMatch(patch, /Project-OS|mvos-new|Tools\/|Upstream-Only|Old\.base/, "only what the copy changed since os-v1");
    assert.doesNotMatch(patch, /\r/, "text goes as upstream stores it");

    upstream.git("apply", "--3way", "--index", out);
    const read = (p) => readFileSync(join(upstream.root, p), "utf8");
    assert.equal(read("Knowledge-OS/Rules/Rule.md"), "rule v2 from the copy\n");
    assert.equal(read("Knowledge-OS/Rules/New.md"), "a rule the copy added\n");
    assert.equal(existsSync(join(upstream.root, "Knowledge-OS", "Rules", "Gone.md")), false);
    assert.equal(read("Knowledge-OS/Rules/Upstream-Only.md"), "added upstream after os-v1\n", "upstream's later work is not undone");
    assert.equal(read("Knowledge-OS/Old.base"), "views: [later]\n");
  } finally {
    rmSync(upstream.root, { recursive: true, force: true });
    rmSync(copy, { recursive: true, force: true });
  }
});

test("--against with no version to start from, or one upstream lacks, is refused", () => {
  const upstream = upstreamMovedOn();
  const unversioned = copyWithoutHistory(null);
  const unknown = copyWithoutHistory("os-v9\n");
  try {
    const a = runAgainst(unversioned, ["--against", upstream.root]);
    assert.equal(a.status, 1);
    assert.match(a.stderr, /no \.os-version.*--base/);
    const b = runAgainst(unknown, ["--against", upstream.root]);
    assert.equal(b.status, 1);
    assert.match(b.stderr, /os-v9.*does not name a commit/);
    assert.equal(runAgainst(unknown, ["--against", upstream.root, "--base", "os-v1", "--out", join(unknown, "p")]).status, 0, "--base overrides");
  } finally {
    for (const d of [upstream.root, unversioned, unknown]) rmSync(d, { recursive: true, force: true });
  }
});

test("a ref that names no commit is refused before anything is written", () => {
  const host = hostAfterChanges();
  try {
    let status = 0;
    let stderr = "";
    try {
      execFileSync(process.execPath, [join(host.root, "V", "Knowledge-OS", "Tools", "os-patch.mjs"), "--since", "os-v9"], {
        cwd: host.root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      status = e.status;
      stderr = e.stderr;
    }
    assert.equal(status, 1);
    assert.match(stderr, /os-v9.*does not name a commit/);
  } finally {
    rmSync(host.root, { recursive: true, force: true });
  }
});
