/**
 * Tests for graph-report.mjs.
 *
 * The report never fails, so nothing stops a wrong number from being read as
 * a fact about the vault. The cases pin the readings that have been wrong
 * before or are easy to get wrong: a relationship field written as a list
 * item, a link shown as code, notes the report must not walk (templates, Dist,
 * fixtures), and the entry point it falls back to when there is no Home.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

function withVault(files, fn) {
  const vault = mkdtempSync(join(tmpdir(), "mv-graph-"));
  try {
    for (const [rel, content] of Object.entries(files)) {
      const p = join(vault, rel.split("/").join(sep));
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
    }
    mkdirSync(join(vault, "Knowledge-OS", "Tools"), { recursive: true });
    cpSync(join(HERE, "graph-report.mjs"), join(vault, "Knowledge-OS", "Tools", "graph-report.mjs"));
    fn((args = []) =>
      JSON.parse(
        execFileSync(process.execPath, [join(vault, "Knowledge-OS", "Tools", "graph-report.mjs"), "--json", ...args], { encoding: "utf8" })
      )
    );
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
}

const note = (type, body) => `---\ntype: ${type}\n---\n\n${body}\n`;

const VAULT = {
  "Knowledge-OS/README.md": note("meta", "# Knowledge OS"),
  "Project-OS/00-Home/Home.md": note("index", "# Home\n\n- contains:: [[Epic-A]]"),
  // The code examples name a real note: were code read as links, Island would
  // stop being isolated and the component count would change.
  "Project-OS/Epic-A.md": note("epic", "# Epic A\n\nSee [[Task-B]] for the work.\n\nAn example, not an edge: `[[Island]]`.\n\n```\n[[Island]]\n```"),
  "Project-OS/Task-B.md": note("task", "# Task B"),
  "Project-OS/Island.md": note("research", "# Nobody links here"),
  "Project-OS/Templates/Epic.md": note("epic", "contains:: [[Task-B]]"),
  "Knowledge-OS/Dist/commands/mv-x.md": "See [[Task-B]].\n",
  "Knowledge-OS/Tools/__fixtures__/f/Project-OS/Note.md": note("task", "[[Task-B]]"),
};

test("a relationship written as a list item is a typed edge, and code is not an edge", () => {
  withVault(VAULT, (report) => {
    const r = report();
    assert.equal(r.typedEdges, 1);
    assert.deepEqual(r.relationshipsInUse, { contains: 1 });
    assert.equal(r.proseEdges, 1, "Epic-A → Task-B; the examples in code count for nothing");
  });
});

test("a path link resolves as the validator resolves it: exact, or by path suffix, never by basename alone", () => {
  const files = {
    ...VAULT,
    "Project-OS/Island.md": note("research", "Partial path: [[00-Home/Home]]. Wrong folder: [[Elsewhere/Task-B]]."),
  };
  withVault(files, (report) => {
    const r = report();
    assert.equal(r.proseEdges, 2, "Epic-A → Task-B and Island → Home; the wrong-folder link is no edge");
    assert.deepEqual(r.components, [4, 1]);
  });
});

test("templates, Dist and fixtures are not notes of this vault", () => {
  withVault(VAULT, (report) => {
    assert.equal(report().notes, 5);
  });
});

test("components, isolated notes and reachability are read from Home", () => {
  withVault(VAULT, (report) => {
    const r = report();
    assert.equal(r.start, "Project-OS/00-Home/Home.md");
    assert.deepEqual(r.components, [3, 1, 1]);
    assert.deepEqual([...r.isolated].sort(), ["Knowledge-OS/README.md", "Project-OS/Island.md"]);
    assert.equal(r.reachable, 3);
  });
});

test("without a Home the walk starts at the Knowledge-OS README, and --from overrides it", () => {
  const { ["Project-OS/00-Home/Home.md"]: _home, ...noHome } = VAULT;
  withVault(noHome, (report) => {
    assert.equal(report().start, "Knowledge-OS/README.md");
    const from = report(["--from", "Project-OS/Epic-A.md"]);
    assert.equal(from.start, "Project-OS/Epic-A.md");
    assert.equal(from.reachable, 2);
  });
});
