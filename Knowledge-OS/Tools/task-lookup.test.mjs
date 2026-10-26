/**
 * Tests for task-lookup.mjs.
 *
 * What matters is what two people on two branches see: a Task taken on a
 * branch that is not merged yet is not offered to anyone else, a branch that
 * is merged or a Task closed here stops counting, and the cursor stays with
 * the working copy that wrote it. The pure part is tested on data; the git
 * part on a throwaway repository with a vault one level down, the way Archi
 * holds it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, cpSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { classify, parseGrep, resolveTask, currentContextShape, byNumber } from "./task-lookup.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

const task = (name, status, key = null) => ({ name, status, key });

test("the lowest-numbered free Task is next, and numbers sort as numbers", () => {
  const r = classify({ tasks: [task("T10-B", "todo"), task("T9-A", "todo"), task("T01-Done", "done")], today: "2026-10-26" });
  assert.deepEqual(r.free, ["T9-A", "T10-B"]);
  assert.deepEqual(r.next, { task: "T9-A", why: "the lowest-numbered free Task" });
  assert.equal(r.openCount, 2);
  assert.deepEqual(["PRJ-12", "PRJ-3", "Notes"].sort(byNumber), ["PRJ-3", "PRJ-12", "Notes"]);
});

test("a Task taken on a branch not merged here is not free, and is not next", () => {
  const r = classify({
    tasks: [task("T02-A", "todo"), task("T03-B", "todo")],
    remote: [{ ref: "origin/task/T02-a", name: "T02-A", status: "in-progress" }],
    dates: { "T02-A": { "origin/task/T02-a": "2026-10-25" } },
    today: "2026-10-26",
  });
  assert.deepEqual(r.free, ["T03-B"]);
  assert.equal(r.next.task, "T03-B");
  assert.deepEqual(r.taken, [{ name: "T02-A", onThisBranch: true, at: [{ where: "origin/task/T02-a", status: "in-progress", date: "2026-10-25", days: 1, stale: false }] }]);
});

test("done here closes a Task whatever a branch still says", () => {
  // A squash-merged branch is never an ancestor of HEAD; its `in-progress` is history.
  const r = classify({ tasks: [task("T01-A", "done"), task("T02-B", "todo")], remote: [{ ref: "task/T01-a", name: "T01-A", status: "in-progress" }], today: "2026-10-26" });
  assert.deepEqual(r.taken, []);
  assert.equal(r.next.task, "T02-B");
});

test("this working copy's Task is next while it is open, and is not listed as taken", () => {
  const tasks = [task("T02-A", "todo"), task("T05-Mine", "in-progress"), task("T06-Theirs", "review")];
  const r = classify({ tasks, cursor: "T05-Mine", today: "2026-10-26" });
  assert.deepEqual(r.next, { task: "T05-Mine", why: "this working copy's Task" });
  assert.deepEqual(r.cursor, { task: "T05-Mine", state: "open", status: "in-progress" });
  assert.deepEqual(r.taken.map((t) => t.name), ["T06-Theirs"]);

  const closed = classify({ tasks: [task("T02-A", "todo"), task("T05-Mine", "done")], cursor: "T05-Mine", today: "2026-10-26" });
  assert.equal(closed.cursor.state, "closed");
  assert.equal(closed.next.task, "T02-A");

  const missing = classify({ tasks: [task("T02-A", "todo")], cursor: "T05-Renamed", today: "2026-10-26" });
  assert.equal(missing.cursor.state, "missing");
});

test("with tasks.next explicit nothing is chosen, but what is free is still said", () => {
  const r = classify({ tasks: [task("PRJ-7", "todo"), task("PRJ-3", "todo")], next: "explicit", today: "2026-10-26" });
  assert.equal(r.next.task, null);
  assert.deepEqual(r.free, ["PRJ-3", "PRJ-7"]);
});

test("a taken Task unchanged for staleDays is reported as possibly abandoned", () => {
  const r = classify({ tasks: [task("T04-Old", "in-progress")], dates: { "T04-Old": { here: "2026-10-01" } }, staleDays: 14, today: "2026-10-26" });
  assert.equal(r.taken[0].at[0].days, 25);
  assert.equal(r.taken[0].at[0].stale, true);
});

test("git grep output over trees is read as ref, path and the first status line", () => {
  const out = "refs/heads/task/T02:V/Tasks/T02-A.md\0status: in-progress\nrefs/heads/task/T02:V/Tasks/T02-A.md\0status: body line\nrefs/remotes/o/x:V/Tasks/T03-B.md\0status: \"review\"\r\n";
  assert.deepEqual(parseGrep(out), [
    { ref: "refs/heads/task/T02", path: "V/Tasks/T02-A.md", name: "T02-A", status: "in-progress" },
    { ref: "refs/remotes/o/x", path: "V/Tasks/T03-B.md", name: "T03-B", status: "review" },
  ]);
});

test("a Task is named by its file name, its number or its key", () => {
  const tasks = [task("T36-Graph-View", "todo"), task("T360-Other", "todo"), task("PRJ-101", "todo", "PRJ-101"), task("Billing", "todo", "BIL-9")];
  assert.deepEqual(resolveTask(tasks, "T36").map((t) => t.name), ["T36-Graph-View"]);
  assert.deepEqual(resolveTask(tasks, "T36-Graph-View.md").map((t) => t.name), ["T36-Graph-View"]);
  assert.deepEqual(resolveTask(tasks, "BIL-9").map((t) => t.name), ["Billing"]);
  assert.deepEqual(resolveTask(tasks, "T99"), []);
});

test("Current Context with a Current Task or Current Goal section has the old shape", () => {
  assert.equal(currentContextShape("# Current Context\n\n## Current Task\n\nT36\n"), "old");
  assert.equal(currentContextShape("# Current Context\r\n\r\n## Current Goal\r\n"), "old");
  assert.equal(currentContextShape("# Current Context\n\n## Active Epics\n\n## Open Questions\n"), "shared");
  assert.equal(currentContextShape(null), "absent");
});

/* ------------------------------------------------------------ with git */

function makeRepo({ git: withGit = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "mv-lookup-"));
  const repo = join(root, "repo");
  const v = join(repo, "V");
  mkdirSync(join(v, "Knowledge-OS", "Tools"), { recursive: true });
  cpSync(join(HERE, "task-lookup.mjs"), join(v, "Knowledge-OS", "Tools", "task-lookup.mjs"));
  cpSync(join(HERE, "vendor"), join(v, "Knowledge-OS", "Tools", "vendor"), { recursive: true });
  const tasks = join(v, "Project-OS", "03-Development", "Tasks");
  mkdirSync(tasks, { recursive: true });
  const put = (name, status) => writeFileSync(join(tasks, `${name}.md`), `---\ntype: task\nstatus: ${status}\nlifecycle: draft\n---\n\n# ${name}\n`);
  put("T01-Done", "done");
  put("T02-Alpha", "todo");
  put("T03-Beta", "todo");
  const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (withGit) {
    git("init", "--quiet", "-b", "master");
    git("config", "user.email", "fixture@example.invalid");
    git("config", "user.name", "Fixture");
    git("config", "commit.gpgsign", "false");
    git("config", "core.autocrlf", "false");
    git("add", "-A");
    git("commit", "--quiet", "-m", "seed");
  }
  const run = (args = [], cwd = v) => {
    const r = spawnSync(process.execPath, [join(cwd, "Knowledge-OS", "Tools", "task-lookup.mjs"), ...args], { encoding: "utf8" });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) };
  };
  return { root, repo, v, put, git, run };
}

test("a claim pushed on someone's branch is seen from master, and stops counting once merged", () => {
  const { root, put, git, run } = makeRepo();
  try {
    git("checkout", "--quiet", "-b", "task/T02-alpha");
    put("T02-Alpha", "in-progress");
    git("commit", "--quiet", "-am", "take T02");
    git("checkout", "--quiet", "master");
    // A teammate's branch, as fetch leaves it: a remote-tracking ref.
    git("update-ref", "refs/remotes/origin/task/T03-beta", "task/T02-alpha");
    git("branch", "--quiet", "-D", "task/T02-alpha");

    let r = run(["--json"]).json();
    assert.deepEqual(r.taken.map((t) => [t.name, t.at.map((a) => a.where)]), [["T02-Alpha", ["origin/task/T03-beta"]]]);
    assert.equal(r.next.task, "T03-Beta");

    git("merge", "--quiet", "--ff-only", "origin/task/T03-beta");
    r = run(["--json"]).json();
    assert.deepEqual(r.taken.map((t) => [t.name, t.at.map((a) => a.where)]), [["T02-Alpha", ["here"]]], "merged: taken here, no longer on the branch");
    assert.ok(r.taken[0].at[0].date, "the date of the commit that took it");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--take refuses a Task taken elsewhere, takes it with --force, and --release forgets it", () => {
  const { root, put, git, run } = makeRepo();
  try {
    put("T02-Alpha", "in-progress");
    git("commit", "--quiet", "-am", "someone took T02");

    let r = run(["--take", "T02"]);
    assert.equal(r.code, 1);
    assert.match(r.stderr, /T02-Alpha is taken: in-progress here/);
    assert.match(run(["--take", "T01"]).stderr, /T01-Done is done; there is nothing to take/);

    r = run(["--take", "T02", "--force"]);
    assert.equal(r.code, 0, r.stderr);
    let j = run(["--json"]).json();
    assert.equal(j.cursor.task, "T02-Alpha");
    assert.equal(j.next.task, "T02-Alpha");
    assert.deepEqual(j.taken, []);
    assert.match(j.cursorFile.replace(/\\/g, "/"), /\.git\/mvos\/cursor\.json$/, "inside git's directory: nothing to ignore");
    assert.equal(git("status", "--porcelain"), "", "the cursor leaves the working tree clean");

    r = run(["--take", "T03"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /Set `status: in-progress` in its note and commit it/);

    assert.equal(run(["--release"]).code, 0);
    j = run(["--json"]).json();
    assert.equal(j.cursor, null);
    assert.equal(j.next.task, "T03-Beta");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("each worktree has its own cursor", () => {
  const { root, repo, git, run } = makeRepo();
  try {
    const wt = join(root, "wt");
    git("worktree", "add", "--quiet", "-b", "other", wt);
    assert.equal(run(["--take", "T02"]).code, 0);
    assert.equal(run(["--json"], join(wt, "V")).json().cursor, null);
    assert.equal(run(["--take", "T03"], join(wt, "V")).code, 0);
    assert.equal(run(["--json"]).json().cursor.task, "T02-Alpha");
    assert.ok(existsSync(join(repo, ".git", "worktrees", "wt", "mvos", "cursor.json")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("without git the cursor lives in .mvos/ of the vault and branches are not looked at", () => {
  const { root, v, run } = makeRepo({ git: false });
  try {
    assert.equal(run(["--take", "T03"]).code, 0);
    assert.equal(JSON.parse(readFileSync(join(v, ".mvos", "cursor.json"), "utf8")).task, "T03-Beta");
    const r = run();
    assert.match(r.stdout, /Not a git repository: branches are not looked at/);
    assert.match(r.stdout, /This working copy is on T03-Beta \(todo\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the report names the old shape of Current Context and where to read how to move it", () => {
  const { root, v, run } = makeRepo({ git: false });
  try {
    mkdirSync(join(v, "Project-OS", "06-AI", "Context"), { recursive: true });
    writeFileSync(join(v, "Project-OS", "06-AI", "Context", "Current-Context.md"), "# Current Context\n\n## Current Task\n\nT02\n");
    assert.match(run().stdout, /Current Context from before os-v8/);
    assert.equal(run(["--json"]).json().currentContext, "old");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
