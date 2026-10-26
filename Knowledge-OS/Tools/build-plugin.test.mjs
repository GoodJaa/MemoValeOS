/**
 * Tests for build-plugin.mjs and the plugin's hook runner.
 *
 * The plugin is generated from Dist/commands and committed; the guarantee
 * worth testing is that the committed plugin is what the generator would
 * write now, so a command edited without a rebuild fails here rather than in
 * someone's installation. Then the wrapper's shape, and the runner: it must
 * parse on old Node and find a vault under any name.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parse } from "acorn";
import { wrapper, pluginFiles, PLUGIN_NAME } from "./build-plugin.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const VAULT = dirname(dirname(HERE));
const RUNNER = join(VAULT, "Knowledge-OS", "Dist", "plugin", "hooks", "budget-audit-runner.cjs");
const HOOK = join(VAULT, "Knowledge-OS", "Dist", "hooks", "budget-audit.cjs");

test("the committed plugin is what the generator writes from Dist/commands", () => {
  const r = spawnSync(process.execPath, [join(HERE, "build-plugin.mjs"), "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("a wrapper carries the source's description, hint and tools, and names the source", () => {
  const src = "---\ndescription: Do a thing\nargument-hint: \"[--x]\"\nallowed-tools: Read, Bash(node:*)\n---\n\nBody.\n";
  const w = wrapper("mv-thing.md", src);
  assert.match(w, /^---\ndescription: Do a thing\nargument-hint: "\[--x\]"\nallowed-tools: Glob, Read, Bash\(node:\*\)\n---\n/);
  assert.match(w, /Knowledge-OS\/Dist\/commands\/mv-thing\.md/);
  assert.match(w, new RegExp(`/${PLUGIN_NAME}:thing`));
  assert.doesNotMatch(w, /Body\./, "the command's text stays in the vault");
});

test("every source command has a wrapper named without the mv- prefix", () => {
  const files = [...pluginFiles().keys()];
  const sources = execFileSync(process.execPath, ["-e", `console.log(require("fs").readdirSync(${JSON.stringify(join(VAULT, "Knowledge-OS", "Dist", "commands"))}).filter(n => /^mv-.+\\.md$/.test(n)).join("\\n"))`], { encoding: "utf8" })
    .trim()
    .split("\n");
  for (const s of sources) assert.ok(files.includes(`Knowledge-OS/Dist/plugin/commands/${s.slice(3)}`), s);
  const market = JSON.parse(pluginFiles().get(".claude-plugin/marketplace.json"));
  assert.equal(market.plugins[0].name, PLUGIN_NAME);
  assert.equal(market.plugins[0].source, "./Knowledge-OS/Dist/plugin");
});

test("--check names a command whose source changed without a rebuild", () => {
  const root = mkdtempSync(join(tmpdir(), "mv-plugin-"));
  try {
    const v = join(root, "V");
    mkdirSync(join(v, "Knowledge-OS", "Tools"), { recursive: true });
    cpSync(join(VAULT, "Knowledge-OS", "Dist"), join(v, "Knowledge-OS", "Dist"), { recursive: true });
    cpSync(join(VAULT, ".claude-plugin"), join(v, ".claude-plugin"), { recursive: true });
    cpSync(join(HERE, "build-plugin.mjs"), join(v, "Knowledge-OS", "Tools", "build-plugin.mjs"));
    const tool = join(v, "Knowledge-OS", "Tools", "build-plugin.mjs");
    assert.equal(spawnSync(process.execPath, [tool, "--check"]).status, 0);

    const src = join(v, "Knowledge-OS", "Dist", "commands", "mv-check.md");
    writeFileSync(src, readFileSync(src, "utf8").replace(/^description: .*$/m, "description: Changed"), "utf8");
    const stale = spawnSync(process.execPath, [tool, "--check"], { encoding: "utf8" });
    assert.equal(stale.status, 1);
    assert.match(stale.stdout, /plugin\/commands\/check\.md/);

    assert.equal(spawnSync(process.execPath, [tool]).status, 0, "a rebuild writes it");
    assert.equal(spawnSync(process.execPath, [tool, "--check"]).status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the hook runner parses as an ECMAScript 2017 script", () => {
  assert.doesNotThrow(() => parse(readFileSync(RUNNER, "utf8"), { ecmaVersion: 2017, sourceType: "script", allowHashBang: true }));
});

/* A vault under another name than MemoValeOS/ must still be found: the spike
 * had the folder name written into the hook's path. */
for (const folder of ["MemoValeOS", "knowledge"]) {
  test(`the runner finds a vault named ${folder}/ and its hook logs the read`, () => {
    const root = mkdtempSync(join(tmpdir(), "mv-runner-"));
    try {
      const vault = join(root, folder);
      mkdirSync(join(vault, "Project-OS"), { recursive: true });
      mkdirSync(join(vault, "Knowledge-OS", "Dist", "hooks"), { recursive: true });
      cpSync(HOOK, join(vault, "Knowledge-OS", "Dist", "hooks", "budget-audit.cjs"));
      const payload = JSON.stringify({ tool_name: "Read", tool_input: { file_path: join(root, "src", "a.ts") } });
      const r = spawnSync(process.execPath, [RUNNER], { input: payload, env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
      assert.equal(r.status, 0);
      const log = readFileSync(join(root, ".claude", "budget-audit.jsonl"), "utf8");
      assert.match(log, /"path":"src\/a\.ts"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("with no vault in the project the runner exits 0 and writes nothing", () => {
  const root = mkdtempSync(join(tmpdir(), "mv-runner-"));
  try {
    const r = spawnSync(process.execPath, [RUNNER], { input: "{}", env: { ...process.env, CLAUDE_PROJECT_DIR: root } });
    assert.equal(r.status, 0);
    assert.throws(() => readFileSync(join(root, ".claude", "budget-audit.jsonl")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
