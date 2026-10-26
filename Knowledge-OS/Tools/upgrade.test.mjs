/**
 * Tests for upgrade.mjs.
 *
 * The script rewrites files in a copy that has its own knowledge beside the OS
 * layer, and since os-v6 it does so with no git history in common with the new
 * version. So the cases are the three-way decisions — taken, kept, merged,
 * conflicting — the files it must never touch whatever the manifest says, and
 * the rollback that stands between a bad version and the copy.
 *
 * Each case builds plain directories, no repositories: `local` is the copy
 * being upgraded, with the script and manifest.mjs copied into it; `new` is
 * the version upgraded to; `base`, when there is one, is what `local` was
 * installed from. A fake validator, where a case needs one, reports an error
 * for every `ERR:<rule>` token it finds under Knowledge-OS/Rules/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, cpSync, existsSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/* README.md, Backlog.md and mvos.config.json are named here although no real
 * manifest names them: the guard that keeps each copy's own files must hold
 * whatever a manifest says. */
const MANIFEST =
  [
    "Knowledge-OS/os-manifest",
    "Knowledge-OS/Tools/*.mjs",
    "Knowledge-OS/Rules/**",
    "Knowledge-OS/Dist/**",
    ".claude-plugin/**",
    "Project-OS/Templates/*.md",
    "!Project-OS/Templates/Task.md",
    "README.md",
    "Backlog.md",
    "mvos.config.json",
  ].join("\n") + "\n";

const COMMON = {
  "Knowledge-OS/os-manifest": MANIFEST,
  "Knowledge-OS/Rules/Rule.md": "rule v1\n",
  "Project-OS/Templates/Epic.md": "epic template v1\n",
  "Project-OS/Templates/Task.md": "task template v1\n",
  "Project-OS/Home.md": "home v1\n",
  "README.md": "readme v1\n",
  "Backlog.md": "backlog v1\n",
  "mvos.config.json": '{"format":1,"language":"en"}\n',
  ".os-version": "os-v1\n",
};

const validator = (extra = "") => `import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const errors = [];
const err = (file, rule, message) => errors.push({ file, rule, message });
const dir = join(VAULT, "Knowledge-OS", "Rules");
for (const f of readdirSync(dir)) {
  const text = readFileSync(join(dir, f), "utf8");
  if (text.includes("ERR:broken-rule")) err(f, "broken-rule", "broken");
  if (text.includes("ERR:deployed-command-drift")) err(f, "deployed-command-drift", "a deployed copy is stale");
${extra}}
console.log(JSON.stringify({ errors, warnings: [] }));
process.exit(errors.length ? 1 : 0);
`;
const NEW_RULE = `  if (text.includes("ERR:new-rule")) err(f, "new-rule", "a new requirement");\n`;

/* `files` overrides COMMON; a null value leaves the file out. */
function makeVault(root, name, files = {}) {
  const dir = join(root, name);
  for (const [rel, text] of Object.entries({ ...COMMON, ...files })) {
    if (text === null) continue;
    const p = join(dir, ...rel.split("/"));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, text);
  }
  for (const tool of ["upgrade.mjs", "manifest.mjs"]) cpSync(join(HERE, tool), join(dir, "Knowledge-OS", "Tools", tool));
  return dir;
}

function upgrade(vault, args) {
  try {
    const out = execFileSync(process.execPath, [join(vault, "Knowledge-OS", "Tools", "upgrade.mjs"), ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

const read = (vault, rel) => {
  const p = join(vault, ...rel.split("/"));
  return existsSync(p) ? readFileSync(p, "utf8") : null;
};

function snapshot(dir) {
  const out = {};
  (function go(d) {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, e.name);
      if (e.isDirectory()) go(full);
      else out[relative(dir, full).split(sep).join("/")] = readFileSync(full, "utf8");
    }
  })(dir);
  return out;
}

function withRoot(fn) {
  const root = mkdtempSync(join(tmpdir(), "mv-upgrade-"));
  try {
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* The base a copy records on its first upgrade: an upgrade from the version
 * it already holds changes nothing and writes .mvos/os-base.json. */
function recordBase(root, local, files = {}) {
  const r = upgrade(local, ["--from", makeVault(root, "installed-from", files), "--apply"]);
  assert.equal(r.code, 0, r.out);
  assert.ok(existsSync(join(local, ".mvos", "os-base.json")), "the first upgrade records its base");
}

test("with a recorded base, unchanged files follow the new version: updated, added, removed", () => {
  withRoot((root) => {
    const local = makeVault(root, "local", { "Knowledge-OS/Rules/Old.md": "dropped upstream\n" });
    recordBase(root, local, { "Knowledge-OS/Rules/Old.md": "dropped upstream\n" });
    const next = makeVault(root, "new", {
      "Knowledge-OS/Rules/Rule.md": "rule v2\n",
      "Knowledge-OS/Rules/Added.md": "added in v2\n",
      "Project-OS/Templates/Epic.md": "epic template v2\n",
      ".os-version": "os-v2\n",
    });
    const r = upgrade(local, ["--from", next, "--apply"]);
    assert.equal(r.code, 0, r.out);
    assert.equal(read(local, "Knowledge-OS/Rules/Rule.md"), "rule v2\n");
    assert.equal(read(local, "Knowledge-OS/Rules/Added.md"), "added in v2\n");
    assert.equal(read(local, "Project-OS/Templates/Epic.md"), "epic template v2\n");
    assert.equal(read(local, "Knowledge-OS/Rules/Old.md"), null, "a file the new version dropped, unchanged here, goes");
    assert.equal(read(local, ".os-version"), "os-v2\n");
    const base = JSON.parse(read(local, ".mvos/os-base.json"));
    assert.equal(base.osVersion, "os-v2");
    assert.ok(base.files["Knowledge-OS/Rules/Added.md"], "the new base is the version just taken");
    assert.equal(base.files["Knowledge-OS/Rules/Old.md"], undefined);
  });
});

test("each copy's own files, its settings and an excluded template are never touched", () => {
  withRoot((root) => {
    const local = makeVault(root, "local");
    recordBase(root, local);
    const next = makeVault(root, "new", {
      "README.md": "upstream's readme\n",
      "Backlog.md": "upstream's backlog\n",
      "mvos.config.json": '{"format":1,"language":"ru"}\n',
      "Project-OS/Templates/Task.md": "upstream's shorter task template\n",
      "Project-OS/Home.md": "upstream's template home\n",
    });
    const r = upgrade(local, ["--from", next, "--apply", "--yes"]);
    assert.equal(r.code, 0, r.out);
    assert.equal(read(local, "README.md"), "readme v1\n");
    assert.equal(read(local, "Backlog.md"), "backlog v1\n");
    assert.equal(read(local, "mvos.config.json"), COMMON["mvos.config.json"]);
    assert.equal(read(local, "Project-OS/Templates/Task.md"), "task template v1\n");
    assert.equal(read(local, "Project-OS/Home.md"), "home v1\n", "a project note is outside the manifest");
  });
});

test("a file changed only here is kept, and one changed on both sides is a conflict left beside it", () => {
  withRoot((root) => {
    const local = makeVault(root, "local", { "Knowledge-OS/Rules/Mine.md": "mine v1\n" });
    recordBase(root, local, { "Knowledge-OS/Rules/Mine.md": "mine v1\n" });
    writeFileSync(join(local, "Knowledge-OS", "Rules", "Mine.md"), "mine, edited here\n");
    writeFileSync(join(local, "Knowledge-OS", "Rules", "Rule.md"), "rule, edited here\n");
    const next = makeVault(root, "new", { "Knowledge-OS/Rules/Mine.md": "mine v1\n", "Knowledge-OS/Rules/Rule.md": "rule v2\n" });
    const r = upgrade(local, ["--from", next, "--apply"]);
    assert.equal(r.code, 2, r.out);
    assert.equal(read(local, "Knowledge-OS/Rules/Mine.md"), "mine, edited here\n");
    assert.equal(read(local, "Knowledge-OS/Rules/Rule.md"), "rule, edited here\n");
    assert.equal(read(local, "Knowledge-OS/Rules/Rule.md.mvos-new"), "rule v2\n");
    assert.match(r.out, /1 conflict/);
  });
});

test("with the base's contents at hand, changes on both sides merge when they do not overlap", () => {
  withRoot((root) => {
    const text = "a\nb\nc\nd\ne\n";
    const base = makeVault(root, "base", { "Knowledge-OS/Rules/Rule.md": text, "Knowledge-OS/Rules/Clash.md": text });
    const local = makeVault(root, "local", { "Knowledge-OS/Rules/Rule.md": "A\nb\nc\nd\ne\n", "Knowledge-OS/Rules/Clash.md": "a\nb\nlocal\nd\ne\n" });
    const next = makeVault(root, "new", { "Knowledge-OS/Rules/Rule.md": "a\nb\nc\nd\nE\n", "Knowledge-OS/Rules/Clash.md": "a\nb\nupstream\nd\ne\n" });
    const r = upgrade(local, ["--from", next, "--base", base, "--apply"]);
    assert.equal(r.code, 2, r.out);
    assert.equal(read(local, "Knowledge-OS/Rules/Rule.md"), "A\nb\nc\nd\nE\n");
    assert.equal(read(local, "Knowledge-OS/Rules/Clash.md"), "a\nb\nlocal\nd\ne\n");
    assert.equal(read(local, "Knowledge-OS/Rules/Clash.md.mvos-new"), "a\nb\nupstream\nd\ne\n");
  });
});

test("with no base, every difference is a conflict, and --yes takes the new version", () => {
  withRoot((root) => {
    const files = { "Knowledge-OS/Rules/Rule.md": "rule v2\n", "Knowledge-OS/Rules/Added.md": "added in v2\n" };
    const local = makeVault(root, "local");
    const r = upgrade(local, ["--from", makeVault(root, "new", files), "--apply"]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /no base to tell which side changed/);
    assert.equal(read(local, "Knowledge-OS/Rules/Rule.md"), "rule v1\n");
    assert.equal(read(local, "Knowledge-OS/Rules/Added.md"), "added in v2\n", "a file only the new version has is still added");

    const other = makeVault(root, "local-yes");
    const y = upgrade(other, ["--from", join(root, "new"), "--apply", "--yes"]);
    assert.equal(y.code, 0, y.out);
    assert.equal(read(other, "Knowledge-OS/Rules/Rule.md"), "rule v2\n");
  });
});

test("without --apply it is a plan, and nothing is written", () => {
  withRoot((root) => {
    const local = makeVault(root, "local");
    const before = snapshot(local);
    const r = upgrade(local, ["--from", makeVault(root, "new", { "Knowledge-OS/Rules/Rule.md": "rule v2\n" }), "--yes"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /nothing was written/);
    assert.deepEqual(snapshot(local), before);
  });
});

test("a version that makes an existing rule report more errors is rolled back, file for file", () => {
  withRoot((root) => {
    const tools = { "Knowledge-OS/Tools/validate-vault.mjs": validator() };
    const local = makeVault(root, "local", tools);
    recordBase(root, local, tools);
    const before = snapshot(local);
    const next = makeVault(root, "new", {
      ...tools,
      "Knowledge-OS/Rules/Rule.md": "rule v2 ERR:broken-rule\n",
      "Knowledge-OS/Rules/Added.md": "added in v2\n",
      ".os-version": "os-v2\n",
    });
    const r = upgrade(local, ["--from", next, "--apply"]);
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /broken-rule 0 → 1/);
    assert.deepEqual(snapshot(local), before, "every file as it was, and no new one left");

    const accepted = upgrade(local, ["--from", next, "--apply", "--accept-errors"]);
    assert.equal(accepted.code, 0, accepted.out);
    assert.equal(read(local, "Knowledge-OS/Rules/Rule.md"), "rule v2 ERR:broken-rule\n");
  });
});

test("errors from a rule the new version adds are a migration, and stale deployed copies wait for the owner", () => {
  withRoot((root) => {
    const local = makeVault(root, "local", { "Knowledge-OS/Tools/validate-vault.mjs": validator() });
    recordBase(root, local, { "Knowledge-OS/Tools/validate-vault.mjs": validator() });
    const next = makeVault(root, "new", {
      "Knowledge-OS/Tools/validate-vault.mjs": validator(NEW_RULE),
      "Knowledge-OS/Rules/Rule.md": "rule v2 ERR:new-rule ERR:deployed-command-drift\n",
    });
    const r = upgrade(local, ["--from", next, "--apply"]);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /new-rule: 1/);
    assert.match(r.out, /deployed-command-drift/);
    assert.equal(read(local, "Knowledge-OS/Rules/Rule.md"), "rule v2 ERR:new-rule ERR:deployed-command-drift\n");
  });
});

test("a script that no longer parses rolls the upgrade back", () => {
  withRoot((root) => {
    const local = makeVault(root, "local");
    recordBase(root, local);
    const before = snapshot(local);
    const next = makeVault(root, "new", { "Knowledge-OS/Tools/broken.mjs": "export const = ;\n" });
    const r = upgrade(local, ["--from", next, "--apply"]);
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /no longer parse[\s\S]*broken\.mjs/);
    assert.deepEqual(snapshot(local), before);
  });
});

test("the steps outside the vault follow the install mode and what changed", () => {
  withRoot((root) => {
    let n = 0;
    const steps = (mode, changed) => {
      const name = `${mode ?? "none"}-${++n}`;
      const local = makeVault(root, `local-${name}`, mode ? { ".mvos/install.json": JSON.stringify({ format: 1, mode }) } : {});
      const r = upgrade(local, ["--from", makeVault(root, `new-${name}`, Object.fromEntries(changed.map((p) => [p, "v2\n"]))), "--yes", "--json"]);
      assert.equal(r.code, 0, r.out);
      return JSON.parse(r.out).ownerSteps.join("\n");
    };
    assert.match(steps("team", ["Knowledge-OS/Dist/commands/mv-x.md"]), /adopt --apply --yes/);
    const pluginOnly = steps("local", ["Knowledge-OS/Dist/plugin/commands/x.md"]);
    assert.match(pluginOnly, /claude plugin update mv@memovaleos --scope local/);
    assert.doesNotMatch(pluginOnly, /adopt/);
    assert.match(steps("local", ["Knowledge-OS/Dist/CLAUDE.redirect.md"]), /adopt --apply --yes/);
    assert.match(steps(null, ["Knowledge-OS/Dist/commands/mv-x.md"]), /adopt"?$/m);
    assert.equal(steps("team", ["Knowledge-OS/Rules/Rule.md"]), "", "nothing to re-apply when Dist/ did not change");
  });
});

test("a --from that is no MemoValeOS vault is refused", () => {
  withRoot((root) => {
    const local = makeVault(root, "local");
    mkdirSync(join(root, "empty"));
    const r = upgrade(local, ["--from", join(root, "empty")]);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /not a MemoValeOS vault/);
  });
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
