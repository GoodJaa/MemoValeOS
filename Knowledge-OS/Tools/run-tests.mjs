#!/usr/bin/env node
/**
 * Run every test file of the OS layer.
 *
 * The `test` script in package.json used to name each `*.test.mjs` by hand,
 * and a new test file stayed out of the run until someone remembered to add
 * it — Docs/06-Tooling/06-6 said so in as many words. A test that never runs
 * reads as coverage and is none. This finds the files instead: every
 * `*.test.mjs` under `Knowledge-OS/`, fixture folders excluded, handed to one
 * `node --test` call.
 *
 * It does not lean on `node --test`'s own glob expansion, which arrived in
 * Node 21. The floor for running the tests is Node 18.
 *
 * Usage:
 *   node "Knowledge-OS/Tools/run-tests.mjs"           # every test file
 *   node "Knowledge-OS/Tools/run-tests.mjs" --list    # print the files, run nothing
 *   node "Knowledge-OS/Tools/run-tests.mjs" adopt     # only files whose path contains "adopt"
 *
 * Exits with the code of `node --test`; 1 when no file matched.
 */
import { readdirSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
// Keep in step with NEVER_WALK in validate-vault.mjs: a fixture folder may one
// day hold a file named like a test, and it is data, not a suite.
const NEVER_WALK = ["node_modules", "__fixtures__", "__provider_fixtures__"];

/** Every `*.test.mjs` under `Knowledge-OS/`, as vault-relative POSIX paths, sorted. */
export function findTestFiles(vault = VAULT) {
  const out = [];
  (function walk(dir) {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || NEVER_WALK.includes(e.name)) continue;
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".test.mjs")) out.push(relative(vault, full).split(sep).join("/"));
    }
  })(join(vault, "Knowledge-OS"));
  return out.sort();
}

function main() {
  const argv = process.argv.slice(2);
  const list = argv.includes("--list");
  const filters = argv.filter((a) => !a.startsWith("--"));
  const files = findTestFiles().filter((f) => filters.length === 0 || filters.some((p) => f.includes(p)));

  if (files.length === 0) {
    console.error(filters.length ? `No test file matches: ${filters.join(", ")}` : "No test files found under Knowledge-OS/.");
    process.exit(1);
  }
  if (list) {
    for (const f of files) console.log(f);
    process.exit(0);
  }
  /* process.execPath, not "node": the tests must run under the Node that was
   * asked to run them, not whichever one PATH happens to offer. */
  const r = spawnSync(process.execPath, ["--test", ...files], { cwd: VAULT, stdio: "inherit" });
  process.exit(r.status === null ? 1 : r.status);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
