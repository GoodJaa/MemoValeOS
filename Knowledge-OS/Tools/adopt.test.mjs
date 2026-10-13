/**
 * Tests for adopt.mjs.
 *
 * This script writes into a project root it does not own, so the tests that
 * matter most are the ones asserting what it leaves alone: a host's agents, a
 * host's own commands, a settings.json it could not parse, and the entire tree
 * when no --apply was given.
 *
 * Each case builds a throwaway project root holding a minimal vault — only the
 * Dist tree and the tool itself, since nothing here reads notes — runs the
 * script against it, and inspects the resulting files.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync, cpSync, statSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VAULT_SRC = dirname(dirname(HERE));
const DIST_SRC = join(VAULT_SRC, "Knowledge-OS", "Dist");

/* A project root with a vault inside it, carrying just enough of the OS layer
 * for adopt.mjs to have something to deploy. */
function makeProject(seed = {}) {
  const root = mkdtempSync(join(tmpdir(), "mv-adopt-"));
  const vault = join(root, "MemoValeOS");
  mkdirSync(join(vault, "Knowledge-OS", "Tools"), { recursive: true });
  cpSync(DIST_SRC, join(vault, "Knowledge-OS", "Dist"), { recursive: true });
  cpSync(join(HERE, "adopt.mjs"), join(vault, "Knowledge-OS", "Tools", "adopt.mjs"));

  for (const [rel, content] of Object.entries(seed)) {
    const p = join(root, rel.split("/").join(sep));
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content, "utf8");
  }
  return { root, vault };
}

function run(vault, args = []) {
  try {
    const stdout = execFileSync("node", [join(vault, "Knowledge-OS", "Tools", "adopt.mjs"), ...args], {
      encoding: "utf8",
      cwd: vault,
    });
    return { code: 0, stdout };
  } catch (e) {
    return { code: e.status ?? 1, stdout: e.stdout ?? "" };
  }
}

/* Every file under a root, as path -> contents, so a whole tree can be
 * compared before and after in one assertion. */
function snapshot(dir, base = dir, out = {}) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) snapshot(full, base, out);
    else out[relative(base, full)] = readFileSync(full, "utf8");
  }
  return out;
}

const read = (root, rel) => readFileSync(join(root, rel.split("/").join(sep)), "utf8");
const has = (root, rel) => existsSync(join(root, rel.split("/").join(sep)));

function withProject(seed, fn) {
  const { root, vault } = makeProject(seed);
  try {
    fn(root, vault);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/* The single most important test here: the default mode must not touch disk.
 * Every other safeguard is a judgement about which file to write; this one is
 * the promise that a user can always look before anything happens. */
test("the default plan writes nothing at all", () => {
  withProject(
    {
      "CLAUDE.md": "# Host\n\nTheir instructions.\n",
      ".claude/settings.json": '{ "hooks": {} }\n',
      ".gitignore": "node_modules/\n",
    },
    (root, vault) => {
      const before = snapshot(root);
      const { code } = run(vault);
      const after = snapshot(root);
      assert.equal(code, 0);
      assert.deepEqual(after, before);
    }
  );
});

test("an empty project root gets commands, hook, settings, redirect and gitignore", () => {
  withProject({}, (root, vault) => {
    const { code } = run(vault, ["--apply"]);
    assert.equal(code, 0);

    const deployed = readdirSync(join(root, ".claude", "commands"));
    const sources = readdirSync(join(DIST_SRC, "commands"));
    assert.deepEqual(deployed.sort(), sources.sort());
    for (const name of sources) {
      assert.equal(read(root, `.claude/commands/${name}`), readFileSync(join(DIST_SRC, "commands", name), "utf8"));
    }

    assert.ok(has(root, ".claude/hooks/budget-audit.mjs"));
    /* The hook's own test travels in Dist so it reaches upstream, but it is
     * this repository's test and has no business in a host project. */
    assert.ok(!has(root, ".claude/hooks/budget-audit.test.mjs"));

    const settings = JSON.parse(read(root, ".claude/settings.json"));
    assert.equal(settings.hooks.PreToolUse[0].matcher, "Read|Grep|Glob");

    assert.match(read(root, "CLAUDE.md"), /MemoValeOS:redirect:begin/);
    assert.match(read(root, ".gitignore"), /\.claude\/budget\.json/);
  });
});

test("a host's own CLAUDE.md is preserved verbatim under the redirect and in the Inbox", () => {
  const body = "# Acme\n\nDeploy on Fridays, never Thursdays.\n";
  withProject({ "CLAUDE.md": body }, (root, vault) => {
    run(vault, ["--apply", "--only", "claude-md"]);

    const now = read(root, "CLAUDE.md");
    assert.ok(now.startsWith("<!-- MemoValeOS:redirect:begin -->"));
    assert.ok(now.includes("Deploy on Fridays, never Thursdays."), "the host's text must survive");

    const inbox = read(root, "MemoValeOS/Project-OS/Inbox/Adopted CLAUDE.md");
    assert.ok(inbox.includes(body.trim()), "the original body must be recoverable in full");
    assert.match(inbox, /Moved verbatim/);
  });
});

test("a settings.json that does not parse is refused and left byte-identical", () => {
  const broken = "{not json,,,";
  withProject({ ".claude/settings.json": broken }, (root, vault) => {
    const { code, stdout } = run(vault, ["--apply", "--only", "settings"]);
    assert.equal(code, 2, "a refusal must be visible in the exit code");
    assert.match(stdout, /not valid JSON/);
    assert.equal(read(root, ".claude/settings.json"), broken);
  });
});

test("an unrelated hook in settings.json survives the merge", () => {
  const theirs = {
    hooks: { PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "echo theirs" }] }] },
  };
  withProject({ ".claude/settings.json": JSON.stringify(theirs, null, 2) }, (root, vault) => {
    run(vault, ["--apply", "--only", "settings"]);
    const after = JSON.parse(read(root, ".claude/settings.json"));
    assert.deepEqual(after.hooks.PostToolUse, theirs.hooks.PostToolUse, "their hook must be untouched");
    assert.equal(after.hooks.PreToolUse.length, 1);
  });
});

/* Someone else already matching on Read|Grep|Glob is the awkward case: the
 * matcher is shared, so ours has to join their array rather than replace it. */
test("an existing Read|Grep|Glob matcher keeps its own hooks and gains ours", () => {
  const theirs = {
    hooks: {
      PreToolUse: [{ matcher: "Read|Grep|Glob", hooks: [{ type: "command", command: "echo mine-first" }] }],
    },
  };
  withProject({ ".claude/settings.json": JSON.stringify(theirs, null, 2) }, (root, vault) => {
    run(vault, ["--apply", "--only", "settings"]);
    const after = JSON.parse(read(root, ".claude/settings.json"));
    assert.equal(after.hooks.PreToolUse.length, 1, "no duplicate matcher");
    const hooks = after.hooks.PreToolUse[0].hooks;
    assert.equal(hooks[0].command, "echo mine-first", "theirs stays, and stays first");
    assert.match(hooks[1].command, /budget-audit\.mjs/);
  });
});

test("running twice changes nothing the second time", () => {
  withProject({ "CLAUDE.md": "# Host\n\nTheirs.\n", ".gitignore": "node_modules/\n" }, (root, vault) => {
    run(vault, ["--apply"]);
    const afterFirst = snapshot(root);
    const { code, stdout } = run(vault, ["--apply"]);
    assert.equal(code, 0);
    assert.match(stdout, /Nothing to change/);
    assert.deepEqual(snapshot(root), afterFirst, "a second apply must be a no-op");
  });
});

test("files outside the mv-* namespace are never touched", () => {
  const theirCommand = "---\ndescription: host tool\n---\nTheirs.\n";
  const theirAgent = "# Reviewer\n\nSee [[Their Playbook]].\n";
  withProject(
    { ".claude/commands/deploy.md": theirCommand, ".claude/agents/reviewer.md": theirAgent },
    (root, vault) => {
      run(vault, ["--apply"]);
      assert.equal(read(root, ".claude/commands/deploy.md"), theirCommand);
      assert.equal(read(root, ".claude/agents/reviewer.md"), theirAgent);
      assert.ok(has(root, ".claude/commands/mv-check.md"), "ours still deployed alongside");
    }
  );
});

/* A modified mv-* file is ours by name, but it is still a file somebody may
 * have edited deliberately, so replacing it is opt-in rather than automatic. */
test("a locally edited mv-* command is refused without --yes and replaced with it", () => {
  withProject({}, (root, vault) => {
    run(vault, ["--apply", "--only", "commands"]);
    const target = join(root, ".claude", "commands", "mv-check.md");
    writeFileSync(target, readFileSync(target, "utf8") + "\nLOCAL EDIT\n", "utf8");

    const refused = run(vault, ["--apply", "--only", "commands"]);
    assert.equal(refused.code, 2);
    assert.match(readFileSync(target, "utf8"), /LOCAL EDIT/, "the edit must survive a refusal");

    const forced = run(vault, ["--apply", "--only", "commands", "--yes"]);
    assert.equal(forced.code, 0);
    assert.doesNotMatch(readFileSync(target, "utf8"), /LOCAL EDIT/);
  });
});

test("--verify reports drift and fails, then passes once deployed", () => {
  withProject({}, (root, vault) => {
    assert.equal(run(vault, ["--verify"]).code, 1, "nothing deployed yet");
    run(vault, ["--apply"]);
    const ok = run(vault, ["--verify"]);
    assert.equal(ok.code, 0);
    assert.match(ok.stdout, /OK —/);
  });
});

test("--only restricts the work to the named classes", () => {
  withProject({ "CLAUDE.md": "# Host\n\nTheirs.\n" }, (root, vault) => {
    run(vault, ["--apply", "--only", "commands"]);
    assert.ok(has(root, ".claude/commands/mv-check.md"));
    assert.ok(!has(root, ".claude/hooks/budget-audit.mjs"), "hooks were out of scope");
    assert.ok(!has(root, ".claude/settings.json"), "settings were out of scope");
    assert.doesNotMatch(read(root, "CLAUDE.md"), /redirect:begin/, "claude-md was out of scope");
  });
});

test("an unknown class is rejected before anything is written", () => {
  withProject({}, (root, vault) => {
    const before = snapshot(root);
    const { code, stdout } = run(vault, ["--apply", "--only", "nonsense"]);
    assert.equal(code, 1);
    assert.match(stdout + "", /Unknown class|^$/);
    assert.deepEqual(snapshot(root), before);
  });
});

/* The redirect's text present but unmarked is what every hand-installed
 * project looks like, including the one this system was built in. Treating it
 * as the host's own knowledge would file a copy of our own redirect into the
 * Inbox and write it straight back. */
test("an unmarked but correct redirect is marked, not moved to the Inbox", () => {
  const redirect = readFileSync(join(DIST_SRC, "CLAUDE.redirect.md"), "utf8");
  withProject({ "CLAUDE.md": redirect }, (root, vault) => {
    run(vault, ["--apply", "--only", "claude-md"]);
    const now = read(root, "CLAUDE.md");
    assert.ok(now.includes("<!-- MemoValeOS:redirect:begin -->"));
    assert.ok(!has(root, "MemoValeOS/Project-OS/Inbox/Adopted CLAUDE.md"), "nothing to adopt here");
  });
});

/* The redirect source says `MemoValeOS/`, the folder name in the project it
 * was written in. Installed under another name, it must name the real one. */
test("the redirect names the vault folder it is actually installed in", () => {
  const root = mkdtempSync(join(tmpdir(), "mv-adopt-"));
  const vault = join(root, "Knowledge");
  try {
    mkdirSync(join(vault, "Knowledge-OS", "Tools"), { recursive: true });
    cpSync(DIST_SRC, join(vault, "Knowledge-OS", "Dist"), { recursive: true });
    cpSync(join(HERE, "adopt.mjs"), join(vault, "Knowledge-OS", "Tools", "adopt.mjs"));
    run(vault, ["--apply", "--only", "claude-md"]);
    const claude = read(root, "CLAUDE.md");
    assert.match(claude, /`Knowledge\/CLAUDE\.md`/);
    assert.doesNotMatch(claude, /MemoValeOS\//);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/* Standalone layout: the vault is the project root, and its CLAUDE.md is the
 * entry point itself — not a host file to redirect away from. */
test("in the standalone layout the vault's own CLAUDE.md is left alone", () => {
  const entry = "# The real entry point\n";
  withProject({ "MemoValeOS/CLAUDE.md": entry }, (root, vault) => {
    const result = run(vault, ["--apply", "--only", "claude-md", "--project", vault]);
    assert.equal(result.code, 0);
    assert.equal(read(root, "MemoValeOS/CLAUDE.md"), entry);
    assert.equal(has(root, "MemoValeOS/Project-OS/Inbox/Adopted CLAUDE.md"), false);
  });
});

test("nothing is ever staged or committed", () => {
  withProject({}, (root, vault) => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    run(vault, ["--apply"]);
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" });
    assert.equal(staged.trim(), "", "the tree must be left dirty for a human to inspect");
  });
});
