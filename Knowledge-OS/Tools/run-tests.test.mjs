/**
 * Tests for run-tests.mjs.
 *
 * Its one job is the list: every test file of the layer is in it, and nothing
 * that only looks like one is. A missed file is the failure it was written to
 * end — a suite that never runs reads as coverage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from "node:fs";
import { join, dirname, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { findTestFiles } from "./run-tests.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("every *.test.mjs next to the tools and in Dist/hooks is found", () => {
  const found = findTestFiles();
  const beside = readdirSync(HERE)
    .filter((n) => n.endsWith(".test.mjs"))
    .map((n) => `Knowledge-OS/Tools/${n}`);
  for (const f of beside) assert.ok(found.includes(f), `${f} is missing from the run`);
  assert.ok(found.includes("Knowledge-OS/Dist/hooks/budget-audit.test.mjs"));
});

test("files under fixture folders, dot-folders and node_modules are not tests", () => {
  const vault = mkdtempSync(join(tmpdir(), "mv-run-tests-"));
  const write = (rel) => {
    const p = join(vault, rel.split("/").join(sep));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "");
  };
  try {
    write("Knowledge-OS/Tools/real.test.mjs");
    write("Knowledge-OS/Tools/__fixtures__/case/Knowledge-OS/Tools/fake.test.mjs");
    write("Knowledge-OS/Tools/__provider_fixtures__/basic/fake.test.mjs");
    write("Knowledge-OS/Tools/node_modules/pkg/fake.test.mjs");
    write("Knowledge-OS/.hidden/fake.test.mjs");
    write("Knowledge-OS/Tools/helper.mjs");
    write("Project-OS/outside.test.mjs");
    assert.deepEqual(findTestFiles(vault), ["Knowledge-OS/Tools/real.test.mjs"]);
  } finally {
    rmSync(vault, { recursive: true, force: true });
  }
});

test("--list prints the files and runs nothing; a filter narrows them", () => {
  const all = execFileSync(process.execPath, [join(HERE, "run-tests.mjs"), "--list"], { encoding: "utf8" })
    .trim()
    .split("\n");
  assert.deepEqual(all, findTestFiles());
  const some = execFileSync(process.execPath, [join(HERE, "run-tests.mjs"), "--list", "stale-check"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n");
  assert.deepEqual(some, ["Knowledge-OS/Tools/stale-check.test.mjs"]);
});

test("a filter that matches nothing exits 1", () => {
  assert.throws(
    () => execFileSync(process.execPath, [join(HERE, "run-tests.mjs"), "--list", "no-such-tool"], { stdio: "pipe" }),
    (e) => e.status === 1
  );
});
