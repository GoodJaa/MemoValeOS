import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* fileURLToPath, not `new URL(...).pathname`: the latter leaves percent-encoding
 * in place, so this file's own directory — `Knowledge-OS`, and `Knowledge OS`
 * before it — arrived as `%20` and every path built from it pointed nowhere.
 * The test could not run at all, which is the likeliest reason it was never in
 * the suite. */
const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOOK = path.join(HERE, "budget-audit.mjs");

/* Each case runs against a throwaway project root.
 *
 * The earlier version of this file pointed at the real `.claude/` and began by
 * unlinking the live `budget-audit.jsonl` — a gitignored log with no second
 * copy, holding every read this project has recorded. Running the test would
 * have destroyed the measurement it exists to protect. It is only luck that it
 * crashed before reaching the unlink. */
function withRoot(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mv-budget-"));
  try {
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fn({
      root,
      run(payload) {
        try {
          execFileSync("node", [HOOK], {
            input: JSON.stringify({ session_id: "s1", ...payload }),
            env: { ...process.env, CLAUDE_PROJECT_DIR: root },
            stdio: ["pipe", "pipe", "pipe"],
          });
          return 0;
        } catch (e) {
          return e.status ?? -1;
        }
      },
      budget(value) {
        fs.writeFileSync(path.join(root, ".claude", "budget.json"), value, "utf8");
      },
      log() {
        try {
          return fs
            .readFileSync(path.join(root, ".claude", "budget-audit.jsonl"), "utf8")
            .trim()
            .split("\n")
            .filter(Boolean)
            .map((l) => JSON.parse(l));
        } catch {
          return [];
        }
      },
      // An absolute path inside the throwaway root, in the platform's own shape.
      at(...parts) {
        return path.join(root, ...parts);
      },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("a read with no budget is recorded as undeclared, not as a violation", () => {
  withRoot((t) => {
    t.run({ tool_name: "Read", tool_input: { file_path: t.at("src", "parser", "normalize.ts") } });
    const L = t.log();
    assert.equal(L.length, 1);
    assert.equal(L[0].declared, false);
    // Null, not false: nothing was declared, so nothing was violated.
    assert.equal(L[0].withinBudget, null);
    assert.equal(L[0].path, "src/parser/normalize.ts");
  });
});

test("a declared budget scores reads inside and outside it", () => {
  withRoot((t) => {
    t.budget(JSON.stringify({ task: "T99", entryPoints: ["src/parser/"] }));
    t.run({ tool_name: "Read", tool_input: { file_path: t.at("src", "parser", "normalize.ts") } });
    t.run({ tool_name: "Read", tool_input: { file_path: t.at("src", "repository", "load-repository.ts") } });

    const L = t.log();
    assert.equal(L.length, 2);
    assert.equal(L[0].withinBudget, true);
    assert.equal(L[1].withinBudget, false);
    assert.equal(L[0].task, "T99");
  });
});

test("a directory entry point covers files nested under it", () => {
  withRoot((t) => {
    t.budget(JSON.stringify({ task: "T99", entryPoints: ["src/parser"] }));
    t.run({ tool_name: "Read", tool_input: { file_path: t.at("src", "parser", "deep", "nested.ts") } });
    assert.equal(t.log()[0].withinBudget, true);
  });
});

test("a subagent's reads are attributed to it", () => {
  withRoot((t) => {
    t.budget(JSON.stringify({ task: "T99", entryPoints: ["src/"] }));
    t.run({
      agent_id: "a1",
      agent_type: "Explore",
      tool_name: "Grep",
      tool_input: { pattern: "x", path: t.at("src", "model") },
    });

    const L = t.log();
    assert.equal(L[0].agent, "Explore");
    assert.equal(L[0].agentId, "a1");
  });
});

test("an unscoped search is not scored at all", () => {
  withRoot((t) => {
    t.run({ tool_name: "Grep", tool_input: { pattern: "x" } });
    // A search with no path reads nothing in particular; scoring it would
    // invent a violation out of a tool call that touched no file.
    assert.deepEqual(t.log(), []);
  });
});

test("a corrupt budget file reads as absent rather than as a boundary", () => {
  withRoot((t) => {
    t.budget("not json");
    t.run({ tool_name: "Read", tool_input: { file_path: t.at("a.ts") } });
    assert.equal(t.log()[0].declared, false);
  });
});

/* The hook runs inside every tool call, so a crash would break the work it is
 * only supposed to observe. Exit 0 on garbage is the load-bearing promise. */
test("garbage on stdin is survived silently", () => {
  withRoot((t) => {
    let code = 0;
    try {
      execFileSync("node", [HOOK], {
        input: "not json at all",
        env: { ...process.env, CLAUDE_PROJECT_DIR: t.root },
        stdio: ["pipe", "pipe", "pipe"],
      });
    } catch (e) {
      code = e.status ?? -1;
    }
    assert.equal(code, 0);
    assert.deepEqual(t.log(), []);
  });
});
