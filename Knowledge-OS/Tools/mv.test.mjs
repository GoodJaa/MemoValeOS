/**
 * Tests for mv.cjs, the launcher.
 *
 * The launcher exists for a host whose default Node is too old to parse the
 * tools, so the first thing pinned here is that it parses as ECMAScript 5 —
 * a modern construct slipping in would break it exactly where it is needed,
 * and the Node running the tests is never that old. Then the choice of Node,
 * on machines described rather than found (a fake nvm tree, an explicit
 * MVOS_NODE, nothing at all), and the CLI: the tool's exit code passes
 * through, an unknown tool and a missing Node are refused with their codes.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { parse } from "acorn";

const HERE = dirname(fileURLToPath(import.meta.url));
const LAUNCHER = join(HERE, "mv.cjs");
const require = createRequire(import.meta.url);
const mv = require("./mv.cjs");

const run = (args, env = {}) => {
  const clean = { ...process.env };
  delete clean.MVOS_NODE;
  return spawnSync(process.execPath, [LAUNCHER, ...args], { encoding: "utf8", env: { ...clean, ...env } });
};

test("mv.cjs parses as ECMAScript 5, so any Node can read it", () => {
  const src = readFileSync(LAUNCHER, "utf8");
  assert.doesNotThrow(() => parse(src, { ecmaVersion: 5, sourceType: "script", allowHashBang: true }));
});

test("versions are read from v-prefixed and bare strings", () => {
  assert.deepEqual(mv.parseVersion("v18.20.8"), [18, 20, 8]);
  assert.deepEqual(mv.parseVersion("20.1.0\n"), [20, 1, 0]);
  assert.equal(mv.parseVersion("not a version"), null);
  assert.ok(mv.compareVersions([18, 20, 8], [18, 3, 0]) > 0);
});

test("the Node running the launcher is used when it is new enough", () => {
  const current = { bin: "/usr/bin/node", version: [22, 1, 0] };
  const r = mv.chooseNode(current, null, [{ bin: "/nvm/v24/bin/node", version: [24, 0, 0], source: "nvm" }]);
  assert.equal(r.node, current);
});

test("an old Node falls back to the newest Node >= 18 found", () => {
  const current = { bin: "/usr/bin/node", version: [12, 22, 12] };
  const found = [
    { bin: "/usr/bin/node", version: [12, 22, 12], source: "PATH" },
    { bin: "/opt/nvm/versions/node/v18.20.8/bin/node", version: [18, 20, 8], source: "nvm" },
    { bin: "/opt/nvm/versions/node/v20.20.2/bin/node", version: [20, 20, 2], source: "nvm" },
    { bin: "/odd/node", version: null, source: "PATH" },
  ];
  const r = mv.chooseNode(current, null, found);
  assert.equal(r.node.bin, "/opt/nvm/versions/node/v20.20.2/bin/node");
});

test("an explicit MVOS_NODE is used, and refused rather than overridden when too old", () => {
  const current = { bin: "/usr/bin/node", version: [22, 0, 0] };
  const ok = { bin: "/x/node18", version: [18, 0, 0] };
  assert.equal(mv.chooseNode(current, ok, []).node, ok);
  const old = mv.chooseNode(current, { bin: "/x/node12", version: [12, 0, 0] }, []);
  assert.equal(old.node, null);
  assert.match(old.reason, /MVOS_NODE .* older than 18/);
  assert.equal(mv.chooseNode(current, { bin: "/x/missing", version: null }, []).node, null);
});

test("nothing suitable is a refusal with the reason", () => {
  const r = mv.chooseNode({ bin: "/usr/bin/node", version: [12, 0, 0] }, null, [{ bin: "/a", version: [16, 0, 0], source: "PATH" }]);
  assert.equal(r.node, null);
  assert.match(r.reason, /no Node >= 18/);
});

test("candidates are found in nvm and nvm-windows trees, versions read from the folder names", () => {
  const root = mkdtempSync(join(tmpdir(), "mv-launcher-"));
  const touch = (...parts) => {
    const p = join(root, ...parts);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, "");
  };
  try {
    touch("nvm", "versions", "node", "v12.22.12", "bin", "node");
    touch("nvm", "versions", "node", "v18.20.8", "bin", "node");
    touch("nvmw", "v20.11.0", "node.exe");
    mkdirSync(join(root, "nvm", "versions", "node", "not-a-version"), { recursive: true });
    const env = { PATH: "", NVM_DIR: join(root, "nvm"), NVM_HOME: join(root, "nvmw") };
    const found = mv
      .findCandidates(env, join(root, "home"), () => null)
      .filter((c) => c.bin.startsWith(root))
      .map((c) => [c.version.join("."), c.source.split(" ")[0]])
      .sort();
    assert.deepEqual(found, [
      ["12.22.12", "nvm"],
      ["18.20.8", "nvm"],
      ["20.11.0", "nvm-windows"],
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a tool runs through the launcher and its exit code passes through", () => {
  const ok = run(["run-tests", "--list", "stale-check"]);
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(ok.stdout.trim(), "Knowledge-OS/Tools/stale-check.test.mjs");
  const fail = run(["run-tests.mjs", "--list", "no-such-test"]);
  assert.equal(fail.status, 1);
});

test("an unknown tool is refused with exit code 2", () => {
  const r = run(["no-such-tool"]);
  assert.equal(r.status, 2);
  assert.match(r.stderr, /Unknown tool `no-such-tool`/);
});

test("an MVOS_NODE that does not exist stops with exit code 3 and says how to fix it", () => {
  const r = run(["run-tests", "--list"], { MVOS_NODE: join(tmpdir(), "no-such-node-binary") });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /MVOS_NODE/);
  assert.match(r.stderr, /doctor/);
});

test("doctor names the Node the tools will run on", () => {
  const r = run(["doctor", "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.equal(report.minimumNode, 18);
  assert.equal(report.chosen.bin, process.execPath);
  assert.match(report.reason, /runs this launcher/);
});
