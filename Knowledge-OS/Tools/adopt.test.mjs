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
import { execFileSync, spawnSync } from "node:child_process";
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
    const stdout = execFileSync(process.execPath, [join(vault, "Knowledge-OS", "Tools", "adopt.mjs"), ...args], {
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

    assert.ok(has(root, ".claude/hooks/budget-audit.cjs"));
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
    assert.match(inbox, /Copied verbatim/);
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
    /* Exec form: no shell, so `${CLAUDE_PROJECT_DIR}` is not left to a shell
     * that, on Windows without Git Bash, would be PowerShell and expand it to
     * nothing. */
    assert.equal(hooks[1].command, "node");
    assert.deepEqual(hooks[1].args, ["${CLAUDE_PROJECT_DIR}/.claude/hooks/budget-audit.cjs"]);
  });
});

/* Every project installed before 2026-10-25 carries the shell-form entry for
 * budget-audit.mjs, the hook that never parsed on a host's Node 12. Matching
 * only the current form would add a second entry beside the old one, which
 * would go on failing on every read. The old entry is replaced in place; the
 * host's own hook keeps its position; the stale file is named, not deleted. */
const OLD_ENTRY = { type: "command", command: 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/budget-audit.mjs"', timeout: 10 };

test("an older budget-audit.mjs entry is replaced in place, never duplicated", () => {
  const settings = {
    hooks: {
      PreToolUse: [{ matcher: "Read|Grep|Glob", hooks: [{ type: "command", command: "echo theirs" }, OLD_ENTRY] }],
    },
  };
  withProject(
    { ".claude/settings.json": JSON.stringify(settings, null, 2), ".claude/hooks/budget-audit.mjs": "// old\n" },
    (root, vault) => {
      const verify = run(vault, ["--verify", "--only", "settings"]);
      assert.equal(verify.code, 1, "an outdated entry is drift");

      const plan = run(vault, ["--only", "settings,hooks"]);
      assert.match(plan.stdout, /\[settings\] replace/);
      assert.match(plan.stdout, /older version of the hook; .* delete it by hand/);

      run(vault, ["--apply", "--only", "settings,hooks"]);
      const after = JSON.parse(read(root, ".claude/settings.json"));
      const hooks = after.hooks.PreToolUse[0].hooks;
      assert.equal(after.hooks.PreToolUse.length, 1);
      assert.equal(hooks.length, 2);
      assert.equal(hooks[0].command, "echo theirs", "the host's hook keeps its place");
      assert.equal(hooks[1].command, "node");
      assert.deepEqual(hooks[1].args, ["${CLAUDE_PROJECT_DIR}/.claude/hooks/budget-audit.cjs"]);
      assert.ok(has(root, ".claude/hooks/budget-audit.cjs"));
      assert.ok(has(root, ".claude/hooks/budget-audit.mjs"), "nothing is deleted");

      const again = run(vault, ["--apply", "--only", "settings"]);
      assert.match(again.stdout, /already current/);
      assert.equal(run(vault, ["--verify", "--only", "settings"]).code, 0);
    }
  );
});

test("duplicate budget entries collapse into one current entry", () => {
  const settings = {
    hooks: {
      PreToolUse: [
        { matcher: "Read|Grep|Glob", hooks: [OLD_ENTRY] },
        { matcher: "Read", hooks: [OLD_ENTRY] },
      ],
    },
  };
  withProject({ ".claude/settings.json": JSON.stringify(settings, null, 2) }, (root, vault) => {
    run(vault, ["--apply", "--only", "settings"]);
    const after = JSON.parse(read(root, ".claude/settings.json"));
    const all = after.hooks.PreToolUse.flatMap((m) => m.hooks);
    assert.equal(all.filter((h) => JSON.stringify(h).includes("budget-audit")).length, 1);
    assert.equal(after.hooks.PreToolUse.length, 1, "a matcher left empty is removed");
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
    assert.ok(!has(root, ".claude/hooks/budget-audit.cjs"), "hooks were out of scope");
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

/* The first real installation: a clone of the distribution, with its own
 * .git, inside the project's repository. The toplevel rule picked the vault
 * and deployed .claude/ into it, where Claude Code never looks. Now the
 * script stops and asks, and an explicit --project, or a record from an
 * earlier apply, settles it. */
test("a vault with its own .git inside another repository is refused until a root is named", () => {
  withProject({}, (root, vault) => {
    const git = (cwd, ...args) => execFileSync("git", args, { cwd, stdio: "ignore" });
    git(root, "init", "-q");
    git(vault, "init", "-q");
    const before = snapshot(root);
    const refused = spawnSync(process.execPath, [join(vault, "Knowledge-OS", "Tools", "adopt.mjs"), "--apply"], { encoding: "utf8", cwd: vault });
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /git repository of its own, inside another one/);
    assert.match(refused.stderr, /--project/);
    assert.match(refused.stderr, /--standalone/);
    assert.deepEqual(snapshot(root), before, "nothing written");

    assert.equal(run(vault, ["--apply", "--team", "--project", root]).code, 0);
    assert.ok(has(root, ".claude/commands/mv-check.md"), "deployed into the project, not the vault");
    assert.ok(!has(root, "MemoValeOS/.claude"));

    const again = run(vault, ["--only", "commands"]);
    assert.equal(again.code, 0, "the record now names the root");
    assert.match(again.stdout, /project root from\s+install record/);
  });
});

test("an apply records the project root, the mode and every deployed file with its hash", () => {
  withProject({}, (root, vault) => {
    run(vault, ["--apply"]);
    const rec = JSON.parse(read(root, "MemoValeOS/.mvos/install.json"));
    assert.equal(rec.format, 1);
    assert.equal(rec.mode, "team");
    assert.equal(rec.projectRoot, "..");
    const paths = rec.files.map((f) => f.path);
    assert.ok(paths.includes(".claude/commands/mv-check.md"));
    assert.ok(paths.includes(".claude/hooks/budget-audit.cjs"));
    for (const f of rec.files) assert.match(f.sha256, /^[0-9a-f]{64}$/);
    assert.deepEqual(rec.blocks.map((b) => b.class).sort(), ["claude-md", "gitignore", "settings"]);

    const plan = run(vault, []);
    assert.match(plan.stdout, /\[record\] .*current/);

    /* An upgrade since the last apply: the plan says the record will name the
     * new version, rather than calling it current. */
    writeFileSync(join(vault, ".os-version"), "os-v99\n");
    assert.match(run(vault, []).stdout, /\[record\] update .*OS version .* → os-v99/);
    run(vault, ["--apply"]);
    assert.equal(JSON.parse(read(root, "MemoValeOS/.mvos/install.json")).osVersion, "os-v99");
  });
});

test("a standalone vault records mode standalone and project root .", () => {
  withProject({ "MemoValeOS/CLAUDE.md": "# The real entry point\n" }, (root, vault) => {
    run(vault, ["--apply", "--standalone", "--only", "commands"]);
    const rec = JSON.parse(read(root, "MemoValeOS/.mvos/install.json"));
    assert.equal(rec.mode, "standalone");
    assert.equal(rec.projectRoot, ".");
    assert.ok(has(root, "MemoValeOS/.claude/commands/mv-check.md"));
  });
});

/* ------------------------------------------- personal install and removal */

/* A project under git with its seed files committed — the shape of a team's
 * repository — and the vault beside them, untracked. */
function withGitProject(seed, fn, rootName) {
  const base = mkdtempSync(join(tmpdir(), "mv-adopt-git-"));
  const root = rootName ? join(base, rootName) : base;
  const vault = join(root, "MemoValeOS");
  try {
    mkdirSync(join(vault, "Knowledge-OS", "Tools"), { recursive: true });
    cpSync(DIST_SRC, join(vault, "Knowledge-OS", "Dist"), { recursive: true });
    cpSync(join(VAULT_SRC, ".claude-plugin"), join(vault, ".claude-plugin"), { recursive: true });
    cpSync(join(HERE, "adopt.mjs"), join(vault, "Knowledge-OS", "Tools", "adopt.mjs"));
    const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    git("config", "commit.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    const tracked = [];
    /* A key starting with `!` is written but left untracked. */
    for (const [key, content] of Object.entries(seed)) {
      const rel = key.replace(/^!/, "");
      const p = join(root, rel.split("/").join(sep));
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, "utf8");
      if (!key.startsWith("!")) tracked.push(rel);
    }
    if (tracked.length) {
      git("add", "--", ...tracked);
      git("commit", "-q", "-m", "seed");
    }
    fn(root, vault, git);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/* Every file under the project except the vault and git's own directory. */
const hostSnapshot = (root) =>
  Object.fromEntries(Object.entries(snapshot(root)).filter(([p]) => !p.startsWith("MemoValeOS") && !p.startsWith(".git" + sep) && p !== ".git"));
const excludeText = (root) => readFileSync(join(root, ".git", "info", "exclude"), "utf8");

const TEAM_RULES = "# Team rules\n\nDeploy on Fridays, never Thursdays.\n";
const THEIR_SETTINGS = JSON.stringify({ hooks: { PostToolUse: [{ matcher: "Write", hooks: [{ type: "command", command: "echo theirs" }] }] } }, null, 2) + "\n";
const CLAUDE_OWNED = JSON.stringify({ permissions: { allow: ["Bash(npm test)"] } }, null, 2) + "\n";

test("a git project with a tracked CLAUDE.md is offered the personal install, and --apply needs a mode", () => {
  withGitProject({ "CLAUDE.md": TEAM_RULES }, (root, vault) => {
    const plan = run(vault, []);
    assert.equal(plan.code, 0);
    assert.match(plan.stdout, /none chosen — recommended: local, because CLAUDE\.md is tracked/);
    assert.match(plan.stdout, /claude plugin install mv@memovaleos --scope local/);
    const before = hostSnapshot(root);
    const applied = spawnSync(process.execPath, [join(vault, "Knowledge-OS", "Tools", "adopt.mjs"), "--apply"], { encoding: "utf8", cwd: vault });
    assert.equal(applied.status, 1);
    assert.match(applied.stderr, /No mode chosen/);
    assert.deepEqual(hostSnapshot(root), before);
  });
});

/* The first real installation's whole difficulty, as one assertion: a
 * personal install into a team's repository changes no tracked file and
 * leaves git with nothing to report. */
test("--local changes no tracked file, leaves git status empty, and hands the plugin step over", () => {
  withGitProject(
    {
      "CLAUDE.md": TEAM_RULES,
      ".gitignore": "node_modules/\n",
      ".claude/settings.json": THEIR_SETTINGS,
      "!.claude/settings.local.json": CLAUDE_OWNED,
    },
    (root, vault, git) => {
      const { code, stdout } = run(vault, ["--apply", "--local"]);
      assert.equal(code, 0, stdout);
      assert.equal(git("status", "--porcelain"), "", "nothing for git to report");
      assert.equal(git("diff"), "");
      assert.equal(read(root, "CLAUDE.md"), TEAM_RULES);
      assert.equal(read(root, ".claude/settings.json"), THEIR_SETTINGS);
      assert.equal(read(root, ".claude/settings.local.json"), CLAUDE_OWNED, "Claude Code's own file is not ours to touch");
      assert.match(read(root, ".claude/rules/memovaleos.md"), /MemoValeOS\/CLAUDE\.md/);
      assert.ok(!has(root, ".claude/commands"), "no copies: the commands come with the plugin");
      assert.match(excludeText(root), /^\/MemoValeOS\/$/m);
      assert.match(stdout, /claude plugin marketplace add ".*MemoValeOS" --scope local/);
      assert.match(stdout, /claude plugin install mv@memovaleos --scope local/);
      const rec = JSON.parse(read(root, "MemoValeOS/.mvos/install.json"));
      assert.equal(rec.mode, "local");
      assert.deepEqual(rec.blocks.map((b) => b.class), ["exclude"]);

      assert.equal(run(vault, ["--verify"]).code, 1, "incomplete until the plugin is installed");
      writeFileSync(join(root, ".claude", "settings.local.json"), JSON.stringify({ enabledPlugins: { "mv@memovaleos": true } }, null, 2) + "\n");
      assert.equal(run(vault, ["--verify"]).code, 0);

      const afterFirst = hostSnapshot(root);
      const exclude = excludeText(root);
      const again = run(vault, ["--apply"]);
      assert.equal(again.code, 0);
      assert.match(again.stdout, /Mode\s+: local\s+\(install record\)/);
      assert.match(again.stdout, /Nothing to change/);
      assert.deepEqual(hostSnapshot(root), afterFirst);
      assert.equal(excludeText(root), exclude, "the exclude block is not appended twice");
    }
  );
});

/* CLAUDE.local.md would have hidden it: Claude Code stops reading AGENTS.md
 * when a CLAUDE.md of any kind is present. The rules file hides nothing. */
test("a host with only AGENTS.md gets no CLAUDE.md of any kind", () => {
  withGitProject({ "AGENTS.md": "# Agents\n" }, (root, vault) => {
    assert.equal(run(vault, ["--apply", "--local"]).code, 0);
    assert.ok(!has(root, "CLAUDE.md"));
    assert.ok(!has(root, "CLAUDE.local.md"));
    assert.ok(has(root, ".claude/rules/memovaleos.md"));
  });
});

test("--uninstall after --local takes out exactly what went in", () => {
  withGitProject({ "CLAUDE.md": TEAM_RULES, "!.claude/settings.local.json": CLAUDE_OWNED }, (root, vault) => {
    const before = hostSnapshot(root);
    const exclude = excludeText(root);
    run(vault, ["--apply", "--local"]);
    const plan = run(vault, ["--uninstall"]);
    assert.match(plan.stdout, /\[rules\] delete \.claude\/rules\/memovaleos\.md/);
    assert.match(plan.stdout, /\[exclude\] remove-block/);
    const { code } = run(vault, ["--uninstall", "--apply"]);
    assert.equal(code, 0);
    assert.deepEqual(hostSnapshot(root), before);
    assert.equal(excludeText(root), exclude);
    assert.ok(!has(root, "MemoValeOS/.mvos/install.json"), "the record goes last");
    assert.ok(has(root, "MemoValeOS/Knowledge-OS"), "the vault is never removed");
  });
});

/* A team install writes into four files the project owns. Taking it out must
 * give each of them back exactly: the redirect and its blank line, our hook
 * entry among theirs, our lines in .gitignore — and their own command stays. */
test("--uninstall after --team gives the host back byte for byte", () => {
  const seed = {
    "CLAUDE.md": "# Host\n\nTheirs.\n",
    ".gitignore": "node_modules/\n",
    ".claude/settings.json": THEIR_SETTINGS,
    ".claude/commands/deploy.md": "---\ndescription: theirs\n---\nTheirs.\n",
  };
  withProject(seed, (root, vault) => {
    const before = hostSnapshot(root);
    assert.equal(run(vault, ["--apply"]).code, 0);
    assert.notDeepEqual(hostSnapshot(root), before);
    const { code, stdout } = run(vault, ["--uninstall", "--apply"]);
    assert.equal(code, 0, stdout);
    assert.deepEqual(hostSnapshot(root), before);
    assert.ok(has(root, "MemoValeOS/Project-OS/Inbox/Adopted CLAUDE.md"), "the copy in the vault stays");
  });
});

test("--uninstall leaves a command edited since install, and says so", () => {
  withProject({}, (root, vault) => {
    run(vault, ["--apply"]);
    const edited = join(root, ".claude", "commands", "mv-check.md");
    writeFileSync(edited, readFileSync(edited, "utf8") + "\nLOCAL EDIT\n", "utf8");
    const { code, stdout } = run(vault, ["--uninstall", "--apply"]);
    assert.equal(code, 2, "a refusal is visible in the exit code");
    assert.match(stdout, /mv-check\.md\s+— edited since it was installed/);
    assert.ok(has(root, ".claude/commands/mv-check.md"));
    assert.ok(!has(root, ".claude/commands/mv-close.md"), "the unedited ones go");
    assert.ok(!has(root, ".claude/settings.json"), "a settings file holding only our hook goes with it");
  });
});

/* The OS layer names no language any more; the project names its own. */
test("--language and --notes write mvos.config.json into the vault and nowhere else", () => {
  withGitProject({ "CLAUDE.md": TEAM_RULES }, (root, vault, git) => {
    const bad = spawnSync(process.execPath, [join(vault, "Knowledge-OS", "Tools", "adopt.mjs"), "--local", "--language", "Russian"], { encoding: "utf8", cwd: vault });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /language tag such as ru/);

    assert.equal(run(vault, ["--apply", "--local", "--language", "ru", "--notes", "split"]).code, 0);
    assert.deepEqual(JSON.parse(read(root, "MemoValeOS/mvos.config.json")), { format: 1, language: "ru", notes: "split" });
    assert.equal(git("status", "--porcelain"), "");

    assert.equal(run(vault, ["--apply", "--language", "en"]).code, 0);
    assert.deepEqual(JSON.parse(read(root, "MemoValeOS/mvos.config.json")), { format: 1, language: "en", notes: "split" }, "notes kept");
    assert.match(run(vault, []).stdout, /\[config\] .*language en, notes split/);
  });
});

test("a project path with spaces installs and excludes correctly", () => {
  withGitProject(
    { "README.md": "# App\n" },
    (root, vault, git) => {
      assert.equal(run(vault, ["--apply", "--local"]).code, 0);
      assert.equal(git("status", "--porcelain"), "");
    },
    "my project"
  );
});

test("nothing is ever staged or committed", () => {
  withProject({}, (root, vault) => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    assert.equal(run(vault, ["--apply", "--team"]).code, 0);
    const staged = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: root, encoding: "utf8" });
    assert.equal(staged.trim(), "", "the tree must be left dirty for a human to inspect");
  });
});
