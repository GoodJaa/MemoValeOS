#!/usr/bin/env node
/* eslint-disable -- runs from a plugin cache or a host project's vault, where
 * the host's linter has no say over it; see Dist/hooks/budget-audit.cjs. */
/**
 * The `mv` plugin's PreToolUse hook: find this project's vault and run the
 * vault's own budget hook, Knowledge-OS/Dist/hooks/budget-audit.cjs.
 *
 * Claude Code runs plugin hooks from its plugin cache, so this file cannot
 * reach the vault by a relative path, and a copy of the budget hook here would
 * be a second source to keep in step with the first. Instead it looks under
 * the project root (CLAUDE_PROJECT_DIR): the root itself when the project is
 * the vault, `MemoValeOS/` when the vault has its usual name, or else the
 * first direct subfolder holding both `Knowledge-OS/` and `Project-OS/`. The
 * spike of 2026-10-25 had the path to `MemoValeOS/` written into hooks.json;
 * a vault under any other name would have logged nothing.
 *
 * The budget hook is loaded in this process (`require`), not started as a
 * second one: this runs on every Read, Grep and Glob. It reads the payload
 * from stdin and exits 0 itself.
 *
 * Same rules as the budget hook: CommonJS, ECMAScript 2017 (the host's own
 * Node runs it, and on the first real installation that was 12), and exit 0
 * on every path — no vault, no hook file, an exception.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function isVault(dir) {
  try {
    return fs.statSync(path.join(dir, "Knowledge-OS")).isDirectory() && fs.statSync(path.join(dir, "Project-OS")).isDirectory();
  } catch (e) {
    return false;
  }
}

function findVault(root) {
  if (isVault(root)) return root;
  const usual = path.join(root, "MemoValeOS");
  if (isVault(usual)) return usual;
  let names;
  try {
    names = fs.readdirSync(root).sort();
  } catch (e) {
    return null;
  }
  for (const name of names) {
    if (name.startsWith(".") || name === "node_modules") continue;
    const dir = path.join(root, name);
    if (isVault(dir)) return dir;
  }
  return null;
}

try {
  const vault = findVault(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const hook = vault ? path.join(vault, "Knowledge-OS", "Dist", "hooks", "budget-audit.cjs") : null;
  if (hook && fs.existsSync(hook)) require(hook);
} catch (e) {
  /* Whatever went wrong, the read it was observing goes ahead. */
}
process.exit(0);
