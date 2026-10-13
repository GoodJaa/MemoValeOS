import { test } from "node:test";
import assert from "node:assert/strict";

import { aggregate, isoWeek, parseNumstatLog } from "./os-share.mjs";
import { compileManifest } from "./manifest.mjs";

/* C3 was read off the metrics log, which only holds sessions that wrote a row —
 * and OS passes mostly did not. These tests pin the git-side count: what
 * counts as an OS commit, how lines are attributed, and how weeks are cut. */

const RS = "\x1e";
const log = [
  `${RS}aaa\t2026-10-05T10:00:00+03:00`,
  "10\t2\tMemoValeOS/Knowledge-OS/Tools/validate-vault.mjs",
  "5\t0\tMemoValeOS/Project-OS/03-Development/Tasks/T30.md",
  "",
  `${RS}bbb\t2026-10-06T09:00:00+03:00`,
  "3\t3\tMemoValeOS/Project-OS/06-AI/Context/Current-Context.md",
  "",
  `${RS}ccc\t2026-10-13T12:00:00+03:00`,
  "-\t-\tMemoValeOS/Knowledge-OS/Dist/icon.png",
  "1\t1\tsrc/index.ts",
  "",
].join("\n");

const isOs = compileManifest(["Knowledge-OS/Tools/*.mjs", "Knowledge-OS/Dist/**", "Project-OS/06-AI/AI.md"].join("\n"));
const toVault = (p) => (p.startsWith("MemoValeOS/") ? p.slice("MemoValeOS/".length) : null);

test("numstat records parse into commits with per-file counts, binary as zero lines", () => {
  const commits = parseNumstatLog(log);
  assert.equal(commits.length, 3);
  assert.deepEqual(commits[0].files[0], { path: "MemoValeOS/Knowledge-OS/Tools/validate-vault.mjs", added: 10, deleted: 2 });
  assert.deepEqual(commits[2].files[0], { path: "MemoValeOS/Knowledge-OS/Dist/icon.png", added: 0, deleted: 0 });
});

/* One OS file in a commit makes it an OS commit; its lines, and only its lines,
 * are OS lines. A path outside the vault is not part of the vault's work. */
test("a commit touching one OS path is an OS commit, and only OS lines count as OS", () => {
  const { total } = aggregate(parseNumstatLog(log), toVault, isOs);
  assert.deepEqual(total, { commits: 3, osCommits: 2, lines: 23, osLines: 12 });
});

test("weeks are ISO weeks starting on Monday", () => {
  assert.equal(isoWeek("2026-10-05"), "2026-W41"); // Monday
  assert.equal(isoWeek("2026-10-11"), "2026-W41"); // Sunday
  assert.equal(isoWeek("2026-10-12"), "2026-W42");
  assert.equal(isoWeek("2027-01-01"), "2026-W53"); // a Friday belongs to the week of the year before
});

test("per-week figures are grouped and ordered by week", () => {
  const { weeks } = aggregate(parseNumstatLog(log), toVault, isOs);
  assert.deepEqual(
    weeks.map((w) => [w.week, w.commits, w.osCommits]),
    [
      ["2026-W41", 2, 1],
      ["2026-W42", 1, 1],
    ]
  );
});

test("a commit that touched nothing inside the vault is not counted", () => {
  const outside = parseNumstatLog(`${RS}ddd\t2026-10-13T12:00:00Z\n4\t4\tsrc/core/index.ts\n`);
  assert.deepEqual(aggregate(outside, toVault, isOs).total, { commits: 0, osCommits: 0, lines: 0, osLines: 0 });
});
