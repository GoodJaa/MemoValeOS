/**
 * The entry files every session loads, held to a size budget.
 *
 * The vault's CLAUDE.md is read into every session of every project the OS is
 * installed into, before any task is known; so is the redirect adopt.mjs puts
 * at the top of the host's own CLAUDE.md. A byte there is paid on every
 * request of every session, which is the opposite of the Prime Directive:
 * context is pulled by the task, not pushed onto it.
 *
 * kaeru paid for the same lesson in a different place: Claude Code cut its
 * MCP server instructions at about 2,048 characters, and the 4,434 it had
 * written lost 54% without a word (LamantinAI/kaeru #48). The fix there was a
 * budget enforced by a test, which is what this is.
 *
 * The limits sit above today's sizes with room to grow. Raise one on purpose,
 * in the commit that says why, rather than trimming text to squeeze under it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

const BUDGETS = [
  // [vault-relative path, bytes] — about 2.0 KB and 0.2 KB today
  ["CLAUDE.md", 3072],
  ["Knowledge-OS/Dist/CLAUDE.redirect.md", 512],
];

for (const [path, limit] of BUDGETS) {
  test(`${path} stays within ${limit} bytes`, (t) => {
    const full = join(VAULT, ...path.split("/"));
    // CLAUDE.md is a per-copy file; a copy may legitimately have none yet.
    if (!existsSync(full)) return t.skip(`${path} is absent in this copy`);
    const size = Buffer.byteLength(readFileSync(full, "utf8").replace(/\r\n/g, "\n"), "utf8");
    assert.ok(size <= limit, `${path} is ${size} bytes, over its ${limit}-byte budget`);
  });
}
