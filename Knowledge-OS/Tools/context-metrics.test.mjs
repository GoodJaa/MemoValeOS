import { test } from "node:test";
import assert from "node:assert/strict";

import { analyseCache, bashTouchesVault, migrateHeader, shellReadPaths, upsertRow } from "./context-metrics.mjs";

/* The reference numbers below were produced by an independent script written
 * during planning, reading the same transcripts this tool reads. They are here
 * so a future change to analyseCache has to agree with a measurement that was
 * made before the function existed, rather than with the function's own output.
 *
 * bdd408e9: 3 breaks, 427,246 tokens reprocessed, across 92 requests.
 * d44b653e: 21 breaks, 17,179,854 tokens, across 715 requests.
 *
 * Those live transcripts are on one machine and are not fixtures; what is
 * reproduced here is the arithmetic that turns a usage series into those
 * numbers, on series small enough to verify by eye. */

const r = (cacheRead, cacheCreation = 0, input = 2) => ({ input, cacheRead, cacheCreation });

/* Timestamped variant, for the break-attribution tests. `min` is minutes since
 * an arbitrary epoch, which is all the classifier reads. */
const at = (min) => new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + min * 60_000).toISOString();
const rt = (cacheRead, min, extra = {}) => ({
  input: 2,
  cacheRead,
  cacheCreation: extra.cacheCreation ?? 0,
  at: at(min),
  model: extra.model ?? "claude-sonnet-5",
  errorSincePrevious: extra.errorSincePrevious ?? false,
});

test("returns null when there is nothing to measure", () => {
  assert.equal(analyseCache([]), null);
  assert.equal(analyseCache(null), null);
  assert.equal(analyseCache(undefined), null);
  // Requests exist but carry no tokens at all: a session that never ran.
  assert.equal(analyseCache([{ input: 0, cacheRead: 0, cacheCreation: 0 }]), null);
});

test("hit rate is cache read over everything the request carried", () => {
  const c = analyseCache([{ input: 10, cacheRead: 80, cacheCreation: 10 }]);
  assert.equal(c.hitRate, 0.8);
  assert.equal(c.creationShare, 0.1);
  assert.equal(c.readToCreateRatio, 8);
});

test("readToCreateRatio is null rather than Infinity when nothing was written", () => {
  const c = analyseCache([{ input: 10, cacheRead: 90, cacheCreation: 0 }]);
  assert.equal(c.readToCreateRatio, null);
});

test("a growing prefix is not a break", () => {
  const c = analyseCache([r(1000, 500), r(1500, 200), r(1700, 100)]);
  assert.equal(c.prefixBreaks, 0);
  assert.equal(c.tokensReprocessed, 0);
  assert.equal(c.worstBreak, null);
});

/* The opening requests of a real session read zero cache while the prefix is
 * still being written. Counting the rise out of zero as a break would report
 * one on every session ever recorded — bdd408e9 opens with four such requests,
 * and its true count is 3, not 4. */
test("the rise out of zero at session start is not a break", () => {
  const c = analyseCache([r(0, 0), r(0, 0), r(38927, 13032), r(51959, 897)]);
  assert.equal(c.prefixBreaks, 0);
});

test("a shortened prefix is a break, and costs the drop plus what was rewritten", () => {
  //                      grows ────────────┐  drops 3000, rewrites 5000
  const c = analyseCache([r(1000, 100), r(4000, 200), r(1000, 5000)]);
  assert.equal(c.prefixBreaks, 1);
  assert.equal(c.tokensReprocessed, 3000 + 5000);
  assert.deepEqual(c.worstBreak, {
    request: 2,
    cost: 8000,
    droppedFrom: 4000,
    droppedTo: 1000,
    // No timestamps in this series, so no cause can be established.
    cause: "unattributed",
    idleMinutes: null,
  });
});

test("worstBreak is the most expensive break, not the last one", () => {
  const c = analyseCache([
    r(10_000, 0),
    r(2_000, 1_000), //  8,000 + 1,000 =  9,000
    r(50_000, 0),
    r(20_000, 5_000), // 30,000 + 5,000 = 35,000  <- worst
    r(60_000, 0),
    r(59_000, 100), //      1,000 +   100 =  1,100
  ]);
  assert.equal(c.prefixBreaks, 3);
  assert.equal(c.tokensReprocessed, 9_000 + 35_000 + 1_100);
  assert.equal(c.worstBreak.request, 3);
  assert.equal(c.worstBreak.cost, 35_000);
});

/* bdd408e9's shape, reduced: four opening requests with no cache, a prefix that
 * grows, and three rollbacks. The real session's totals are 3 and 427,246. */
test("reproduces the shape of the bdd408e9 reference session", () => {
  const c = analyseCache([
    r(0, 0),
    r(0, 0),
    r(0, 0),
    r(0, 0),
    r(38_927, 13_032),
    r(51_959, 897),
    r(92_420, 2_825),
    r(38_927, 53_491), // break 1
    r(116_987, 1_120),
    r(38_927, 78_058), // break 2
    r(128_821, 638),
    r(44_711, 85_201), // break 3
  ]);
  assert.equal(c.prefixBreaks, 3);
  assert.equal(
    c.tokensReprocessed,
    92_420 - 38_927 + 53_491 + (116_987 - 38_927 + 78_058) + (128_821 - 44_711 + 85_201)
  );
  assert.equal(c.worstBreak.request, 11);
  assert.equal(c.requests, 12);
});

/* ------------------------------------------------- break attribution (B19) */

/* The one-hour boundary is not a guess: measured across 35 sessions the break
 * rate is 0% under a minute, 14% at 15-30 minutes, then 100% in the 60-90
 * minute band. Below the boundary the cache survives; above it, it does not. */
test("a pause longer than the cache TTL is attributed to expiry", () => {
  const c = analyseCache([rt(10_000, 0), rt(50_000, 1), rt(20_000, 62, { cacheCreation: 5_000 })]);
  assert.equal(c.prefixBreaks, 1);
  assert.equal(c.byCause.ttlExpiry, 1);
  assert.equal(c.costByCause.ttlExpiry, 30_000 + 5_000);
  assert.equal(c.worstBreak.cause, "ttlExpiry");
  assert.equal(c.worstBreak.idleMinutes, 61);
});

test("a pause just under the TTL is not attributed to expiry", () => {
  const c = analyseCache([rt(10_000, 0), rt(50_000, 1), rt(20_000, 60)]);
  assert.equal(c.prefixBreaks, 1);
  assert.equal(c.byCause.ttlExpiry, 0);
  assert.equal(c.byCause.unattributed, 1);
});

test("a break after an api_error is attributed to the retry", () => {
  const c = analyseCache([rt(10_000, 0), rt(50_000, 1), rt(20_000, 2, { errorSincePrevious: true })]);
  assert.equal(c.byCause.apiError, 1);
  assert.equal(c.worstBreak.cause, "apiError");
});

test("a break across a model change is attributed to the switch", () => {
  const c = analyseCache([rt(10_000, 0), rt(50_000, 1), rt(20_000, 2, { model: "claude-opus-5" })]);
  assert.equal(c.byCause.modelSwitch, 1);
});

/* Idle time outranks the other two: a long pause explains the break on its own,
 * and an error or a model change that happens to coincide with it does not add
 * anything. Attributing to the weaker signal would inflate its share. */
test("idle time outranks a coinciding error or model change", () => {
  const c = analyseCache([
    rt(10_000, 0),
    rt(50_000, 1),
    rt(20_000, 90, { errorSincePrevious: true, model: "claude-opus-5" }),
  ]);
  assert.equal(c.byCause.ttlExpiry, 1);
  assert.equal(c.byCause.apiError, 0);
  assert.equal(c.byCause.modelSwitch, 0);
});

test("a break with no idle time, no error and no model change stays unattributed", () => {
  const c = analyseCache([rt(10_000, 0), rt(50_000, 1), rt(20_000, 2)]);
  assert.equal(c.byCause.unattributed, 1);
  assert.equal(c.costByCause.unattributed, 30_000);
});

/* Timestamps are absent from the hand-built series the other tests use, and
 * from any transcript record that carries no timestamp. Attribution must
 * degrade to `unattributed` rather than throw or invent an idle time. */
test("a series without timestamps still counts breaks, attributing none to TTL", () => {
  const c = analyseCache([r(10_000), r(50_000), r(20_000)]);
  assert.equal(c.prefixBreaks, 1);
  assert.equal(c.byCause.ttlExpiry, 0);
  assert.equal(c.byCause.unattributed, 1);
  assert.equal(c.longestIdleMinutes, 0);
  assert.equal(c.worstBreak.idleMinutes, null);
});

test("longestIdleMinutes reports the longest pause, break or not", () => {
  const c = analyseCache([rt(10_000, 0), rt(20_000, 45), rt(30_000, 50)]);
  assert.equal(c.prefixBreaks, 0);
  assert.equal(c.longestIdleMinutes, 45);
});

test("missing usage fields count as zero rather than throwing", () => {
  const c = analyseCache([{ cacheRead: 100 }, { input: 5 }, {}]);
  assert.equal(c.prefixBreaks, 0);
  assert.equal(c.hitRate, 100 / 105);
});

/* ------------------------------------------------------- the log table */

const H8 = "| Session | Ended | Requests | Output | Context peak | Files | Re-read | Coverage |";
const H15 =
  "| Session | Ended | Requests | Output | Context peak | Mean | p95 | Notes | Files | Re-read | Coverage | Hit% | Breaks | Reproc | Label |";

const logWith = (header, ...rows) => ["# Context Metrics", "", header, "|---|---|", ...rows, ""].join("\n");

test("a log already on the current header is left alone", () => {
  const before = logWith(H15, "| abc12345 | 2026-09-17 10:00 | 12 |");
  const after = migrateHeader(before, H15);
  assert.equal(after.migrated, false);
  assert.equal(after.text, before);
});

test("an older header is replaced and its narrow rows are padded, not zeroed", () => {
  const before = logWith(H8, "| abc12345 | 2026-09-17 10:00 | 12 | 3,400 | 90,000 | 8 | 10% | 60% |");
  const after = migrateHeader(before, H15);

  assert.equal(after.migrated, true);
  assert.equal(after.padded, 1);

  const lines = after.text.split("\n");
  assert.equal(lines[2], H15);
  assert.equal(lines[3], "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");

  const cells = lines[4].split("|").slice(1, -1).map((c) => c.trim());
  assert.equal(cells.length, 15);
  // The measurement it did carry survives in place.
  assert.equal(cells[0], "abc12345");
  assert.equal(cells[2], "12");
  // The columns it never had say "not measured", never "zero".
  assert.deepEqual(cells.slice(8), ["—", "—", "—", "—", "—", "—", "—"]);
  assert.ok(!cells.includes("0"));
});

/* The case that made the header wrong in the first place: rows written after
 * the script grew columns, under a header that never did. Once the header is
 * corrected those rows are already right, so touching them would destroy real
 * measurements to satisfy a header that just caught up. */
test("rows at least as wide as the new header are not touched", () => {
  const wide = "| e2fd480f | 2026-09-17 10:00 | 79 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | task |";
  const after = migrateHeader(logWith(H8, wide), H15);
  assert.equal(after.padded, 0);
  assert.ok(after.text.includes(wide));
});

test("a session absent from the table is appended", () => {
  const before = logWith(H15, "| aaaaaaaa | x |");
  const row = "| bbbbbbbb | 2026-09-17 11:00 | 5 |";
  const after = upsertRow(before, "bbbbbbbb", row);

  assert.equal(after.replaced, false);
  assert.ok(after.text.includes("| aaaaaaaa | x |"));
  assert.ok(after.text.includes(row));
});

/* Closing a session twice is the ordinary case this exists for: the second
 * close sees everything the first did plus the work that followed it. The
 * older row is never the truer one, so replacement carries no condition. */
test("closing the same session again replaces its row instead of skipping it", () => {
  const first = "| e2fd480f | 2026-09-17 10:00 | 79 | first |";
  const second = "| e2fd480f | 2026-09-17 12:30 | 143 | second |";

  const after = upsertRow(logWith(H15, "| aaaaaaaa | x |", first), "e2fd480f", second);

  assert.equal(after.replaced, true);
  assert.ok(after.text.includes(second));
  assert.ok(!after.text.includes(first), "the superseded numbers must not survive");
  // Exactly one row for the session, and the neighbour is undisturbed.
  assert.equal(after.text.split("\n").filter((l) => l.startsWith("| e2fd480f |")).length, 1);
  assert.ok(after.text.includes("| aaaaaaaa | x |"));
});

test("a short id never collides with a row that merely contains it", () => {
  const other = "| 12345678 | note mentioning abcdef12 somewhere | 3 |";
  const after = upsertRow(logWith(H15, other), "abcdef12", "| abcdef12 | new | 1 |");
  assert.equal(after.replaced, false);
  assert.ok(after.text.includes(other));
});

/* A log written on Windows carries `\r` at the end of every line. Comparing it
 * to the header constant raw reports a migration on every single run and
 * rewrites the table to say exactly what it already said — noise that would
 * teach the reader to ignore the message. Found by running the tool against
 * this project's own log, not by reading the code. */
test("a header differing only in line endings is not a migration", () => {
  const crlf = ["# Context Metrics", "", H15, "|---|---|", "| abc12345 | x |", ""].join("\r\n");
  assert.equal(migrateHeader(crlf, H15).migrated, false);
});

/* ------------------------------------------- the vault reached through Bash */

/* A session driven through Bash calls no file tool at all, so every bucket stays
 * empty and `touchedVault` reads false. Under `/mv-close` in auto mode that is
 * the norm rather than the exception: the session dropped out of selection
 * entirely, the previous session became "most recent", and `--write` replaced
 * ITS row — printing `replaced 1 row(s)` and exiting 0. No step refused.
 *
 * Caught only because the id written did not match the newest transcript file.
 * These tests pin the recognition; they say nothing about which files were read,
 * because a shell command cannot be resolved to a file list. */

test("a shell command naming a managed tree counts as touching the vault", () => {
  assert.equal(bashTouchesVault("cat Knowledge-OS/Tools/validate-vault.mjs"), true);
  assert.equal(bashTouchesVault("grep -n status Project-OS/03-Development/Tasks/T26.md"), true);
  assert.equal(bashTouchesVault("sed -n '1,20p' Metrics/Context-Metrics.md"), true);
});

test("the vault's own directory name counts, even with no managed tree named", () => {
  // `MemoValeOS/Backlog.md` names no managed tree, but leads inside the vault.
  assert.equal(bashTouchesVault("cat MemoValeOS/Backlog.md", "MemoValeOS"), true);
});

test("a Windows path separator is recognised the same as a posix one", () => {
  assert.equal(bashTouchesVault("type Knowledge-OS\\Tools\\adopt.mjs"), true);
});

test("a command touching nothing in the vault is not counted", () => {
  assert.equal(bashTouchesVault("npm run lint"), false);
  assert.equal(bashTouchesVault("git status --short"), false);
  assert.equal(bashTouchesVault("cat src/core/index.ts"), false);
});

/* A bare mention is not a path. Requiring the trailing separator keeps a commit
 * message or a log line from promoting a session into the selection. */
test("naming a tree without a path separator is not a touch", () => {
  assert.equal(bashTouchesVault("git commit -m 'Knowledge-OS cleanup'"), false);
});

test("a missing or non-string command is not a touch", () => {
  assert.equal(bashTouchesVault(undefined), false);
  assert.equal(bashTouchesVault(null), false);
  assert.equal(bashTouchesVault(""), false);
  assert.equal(bashTouchesVault({ command: "cat Knowledge-OS/x" }), false);
});

/* ------------------------------------------- the files a shell command reads */

/* bashTouchesVault only said "the vault was reached". Sixteen task sessions in
 * this project's log carry Re-read "—" for that reason, and "rules are not read,
 * yet followed" was drawn from rows that could not see a `cat`. shellReadPaths
 * names the files; these tests pin which arguments count as one and which do
 * not, because a pattern or a number taken for a path would invent reads. */

test("a read verb's path arguments are returned, anchored to the vault by its name", () => {
  assert.deepEqual(shellReadPaths("cat MemoValeOS/Project-OS/06-AI/AI.md", "MemoValeOS"), ["Project-OS/06-AI/AI.md"]);
  assert.deepEqual(shellReadPaths("head -n 40 Knowledge-OS/README.md", "MemoValeOS"), ["Knowledge-OS/README.md"]);
});

test("the pattern or script before the file is not taken for a path", () => {
  assert.deepEqual(shellReadPaths("sed -n '30,80p' Knowledge-OS/Rules/AI-Governance.md", "V"), [
    "Knowledge-OS/Rules/AI-Governance.md",
  ]);
  assert.deepEqual(shellReadPaths('grep -n "status" Project-OS/Templates/Task.md Project-OS/Templates/Epic.md', "V"), [
    "Project-OS/Templates/Task.md",
    "Project-OS/Templates/Epic.md",
  ]);
  // With the pattern given through an option, the first positional is a file.
  assert.deepEqual(shellReadPaths("grep -e status Project-OS/a.md", "V"), ["Project-OS/a.md"]);
});

test("a Windows path and a Git Bash drive both come back as one absolute form", () => {
  assert.deepEqual(shellReadPaths('cat "D:\\work\\V\\Knowledge-OS\\Rules\\A.md"', "V"), [
    "D:/work/V/Knowledge-OS/Rules/A.md",
  ]);
  assert.deepEqual(shellReadPaths("cat /d/work/V/Project-OS/a.md", "V"), ["d:/work/V/Project-OS/a.md"]);
});

test("a relative path is anchored to the directory the command cd-ed into", () => {
  assert.deepEqual(shellReadPaths("cd /d/work/V && head -5 Project-OS/a.md", "V"), [
    "d:/work/V/Project-OS/a.md",
  ]);
});

test("PowerShell readers count, with -Path and with a positional path", () => {
  assert.deepEqual(shellReadPaths("Get-Content -Path Project-OS\\05-Decisions\\ADR-001.md -TotalCount 40", "V"), [
    "Project-OS/05-Decisions/ADR-001.md",
  ]);
  assert.deepEqual(shellReadPaths("Get-Content Knowledge-OS\\README.md | Select-Object -First 10", "V"), [
    "Knowledge-OS/README.md",
  ]);
  assert.deepEqual(shellReadPaths("Select-String -Pattern lifecycle -Path Project-OS\\a.md", "V"), ["Project-OS/a.md"]);
});

test("pipes, redirections and non-read verbs add nothing", () => {
  assert.deepEqual(shellReadPaths("cat Project-OS/a.md 2>/dev/null | head -5", "V"), ["Project-OS/a.md"]);
  assert.deepEqual(shellReadPaths("git log --oneline -- Project-OS/a.md && npm test", "V"), []);
  assert.deepEqual(shellReadPaths('echo "cat Project-OS/a.md"', "V"), []);
  assert.deepEqual(shellReadPaths("cat $FILE", "V"), []);
});

test("a missing or non-string command reads nothing", () => {
  assert.deepEqual(shellReadPaths(undefined), []);
  assert.deepEqual(shellReadPaths(""), []);
  assert.deepEqual(shellReadPaths({ command: "cat Project-OS/a.md" }), []);
});
