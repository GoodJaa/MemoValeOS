#!/usr/bin/env node
/*
 * mv.cjs — one entry point for the OS layer's tools, on whatever Node the
 * host project has.
 *
 * The tools need Node 18. A host's default Node is often older: on the first
 * real installation it was 12, every tool died on `??` with a SyntaxError, and
 * over 24 sessions the assistant typed the path to a newer Node by hand 209
 * times. This file is what turns "which Node?" from a question asked in every
 * session into an answer found once:
 *
 *   1. MVOS_NODE, when set, is used — and refused if it is too old: an
 *      explicit setting is not silently overridden;
 *   2. otherwise the Node running this file, when it is new enough;
 *   3. otherwise the newest Node >= 18 found on PATH, under nvm ($NVM_DIR,
 *      ~/.nvm, /opt/nvm, /usr/local/nvm) or nvm-windows (%NVM_HOME%,
 *      %NVM_SYMLINK%);
 *   4. otherwise it stops, names every Node it found and says how to fix it.
 *
 * The chosen Node then runs the tool as a child process, with stdin, stdout
 * and stderr passed through, and its exit code becomes this one's.
 *
 * Written in ES5 CommonJS on purpose, the one thing in the layer that is: the
 * old Node has to be able to *parse* this file before it can find the new
 * one. A `?.` here would fail exactly where the file is needed. The syntax is
 * pinned by a test (mv.test.mjs parses it as ECMAScript 5).
 *
 * Usage:
 *   node "<vault>/Knowledge-OS/Tools/mv.cjs" <tool> [args...]   # e.g. validate-vault, adopt --verify
 *   node "<vault>/Knowledge-OS/Tools/mv.cjs" doctor [--json]     # which Node runs the tools, and why
 *   node "<vault>/Knowledge-OS/Tools/mv.cjs" --help
 *
 * <tool> is the name of any Knowledge-OS/Tools/<tool>.mjs, with or without
 * the extension. Exit codes: the tool's own; 2 for an unknown tool; 3 when no
 * Node >= 18 can be found.
 */
"use strict";

var fs = require("fs");
var path = require("path");
var cp = require("child_process");
var os = require("os");

var MIN_MAJOR = 18;
var TOOLS_DIR = __dirname;
var VAULT = path.dirname(path.dirname(TOOLS_DIR));
var IS_WIN = process.platform === "win32";
var NODE_EXE = IS_WIN ? "node.exe" : "node";

/* "v18.20.8" or "18.20.8" → [18, 20, 8]; anything else → null. */
function parseVersion(s) {
  var m = /v?(\d+)\.(\d+)\.(\d+)/.exec(String(s || ""));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compareVersions(a, b) {
  for (var i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

function versionString(v) {
  return v ? "v" + v.join(".") : "unknown";
}

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch (e) {
    return false;
  }
}

/* Ask a binary its version. Used only for binaries whose path does not say. */
function probeVersion(bin) {
  try {
    var r = cp.spawnSync(bin, ["--version"], { encoding: "utf8", timeout: 5000 });
    if (r.status === 0) return parseVersion(r.stdout);
  } catch (e) {
    /* not runnable: no version */
  }
  return null;
}

/* Every `v<x.y.z>` folder in an nvm-style versions directory. */
function versionFolders(dir) {
  var out = [];
  var names;
  try {
    names = fs.readdirSync(dir);
  } catch (e) {
    return out;
  }
  for (var i = 0; i < names.length; i++) {
    var v = parseVersion(names[i]);
    if (v && /^v?\d/.test(names[i])) out.push({ dir: path.join(dir, names[i]), version: v });
  }
  return out;
}

/*
 * Every Node binary this machine offers, as [{bin, source, version}], with
 * the same file listed once even when several places point at it. `env` and
 * `home` are parameters so tests can describe a machine that is not this one.
 * `version` is null where neither the path nor a probe could tell.
 */
function findCandidates(env, home, probe) {
  env = env || process.env;
  home = home || os.homedir();
  probe = probe || probeVersion;
  var out = [];
  var seen = {};

  function add(bin, source, version) {
    var key;
    try {
      key = fs.realpathSync(bin);
    } catch (e) {
      return;
    }
    if (seen[key]) {
      if (seen[key].source.indexOf(source) === -1) seen[key].source += ", " + source;
      return;
    }
    if (!isFile(bin)) return;
    var entry = { bin: bin, source: source, version: version || probe(bin) };
    seen[key] = entry;
    out.push(entry);
  }

  var pathDirs = String(env.PATH || env.Path || "").split(path.delimiter);
  for (var i = 0; i < pathDirs.length; i++) {
    if (pathDirs[i]) add(path.join(pathDirs[i], NODE_EXE), "PATH");
  }

  var nvmRoots = [env.NVM_DIR, path.join(home, ".nvm"), "/opt/nvm", "/usr/local/nvm"];
  for (var j = 0; j < nvmRoots.length; j++) {
    if (!nvmRoots[j]) continue;
    var folders = versionFolders(path.join(nvmRoots[j], "versions", "node"));
    for (var k = 0; k < folders.length; k++) {
      add(path.join(folders[k].dir, "bin", "node"), "nvm (" + nvmRoots[j] + ")", folders[k].version);
    }
  }

  if (env.NVM_HOME) {
    var winFolders = versionFolders(env.NVM_HOME);
    for (var w = 0; w < winFolders.length; w++) {
      add(path.join(winFolders[w].dir, "node.exe"), "nvm-windows", winFolders[w].version);
    }
  }
  if (env.NVM_SYMLINK) add(path.join(env.NVM_SYMLINK, "node.exe"), "nvm-windows (current)");

  return out;
}

/*
 * Pick the Node that runs the tools. `current` is {bin, version} of the Node
 * running this file; `explicit` is MVOS_NODE as {bin, version} or null.
 * Returns {node, reason} or {node: null, reason}.
 */
function chooseNode(current, explicit, candidates) {
  if (explicit) {
    if (!explicit.version) return { node: null, reason: "MVOS_NODE (" + explicit.bin + ") does not run or does not report a version" };
    if (explicit.version[0] < MIN_MAJOR) {
      return { node: null, reason: "MVOS_NODE (" + explicit.bin + ") is " + versionString(explicit.version) + ", older than " + MIN_MAJOR };
    }
    return { node: explicit, reason: "MVOS_NODE" };
  }
  if (current.version && current.version[0] >= MIN_MAJOR) return { node: current, reason: "the Node that runs this launcher" };
  var best = null;
  for (var i = 0; i < candidates.length; i++) {
    var c = candidates[i];
    if (!c.version || c.version[0] < MIN_MAJOR) continue;
    if (!best || compareVersions(c.version, best.version) > 0) best = c;
  }
  if (best) return { node: best, reason: "the newest Node >= " + MIN_MAJOR + " found (" + best.source + ")" };
  return { node: null, reason: "no Node >= " + MIN_MAJOR + " in MVOS_NODE, PATH, nvm or nvm-windows" };
}

function toolNames() {
  var names = [];
  var files = fs.readdirSync(TOOLS_DIR);
  for (var i = 0; i < files.length; i++) {
    if (/\.mjs$/.test(files[i]) && !/\.test\.mjs$/.test(files[i])) names.push(files[i].replace(/\.mjs$/, ""));
  }
  return names.sort();
}

function osVersion() {
  try {
    return fs.readFileSync(path.join(VAULT, ".os-version"), "utf8").trim();
  } catch (e) {
    return "";
  }
}

function resolveChoice(env) {
  var current = { bin: process.execPath, source: "this process", version: parseVersion(process.version) };
  var explicit = env.MVOS_NODE ? { bin: env.MVOS_NODE, source: "MVOS_NODE", version: isFile(env.MVOS_NODE) ? probeVersion(env.MVOS_NODE) : null } : null;
  var needSearch = !explicit && !(current.version && current.version[0] >= MIN_MAJOR);
  var candidates = needSearch ? findCandidates(env) : [];
  return { current: current, explicit: explicit, candidates: candidates, choice: chooseNode(current, explicit, candidates) };
}

function noNodeMessage(state) {
  var lines = [];
  lines.push("MemoValeOS needs Node " + MIN_MAJOR + " or newer: " + state.choice.reason + ".");
  lines.push("This launcher runs on " + versionString(state.current.version) + " (" + state.current.bin + ").");
  var found = state.candidates.length ? state.candidates : findCandidates(process.env);
  if (found.length) {
    lines.push("Node binaries found:");
    for (var i = 0; i < found.length; i++) lines.push("  " + versionString(found[i].version) + "  " + found[i].bin + "  (" + found[i].source + ")");
  }
  lines.push("Fix it once, then every tool and /mv-* command picks it up:");
  lines.push("  - install Node " + MIN_MAJOR + "+ (`nvm install " + MIN_MAJOR + "`, or a package from nodejs.org), or");
  lines.push("  - point MVOS_NODE at an existing one, e.g. MVOS_NODE=/path/to/node");
  lines.push('Then check: node "' + path.join(TOOLS_DIR, "mv.cjs") + '" doctor');
  return lines.join("\n");
}

function doctor(asJson) {
  var state = resolveChoice(process.env);
  var all = state.candidates.length ? state.candidates : findCandidates(process.env);
  var report = {
    vault: VAULT,
    osVersion: osVersion(),
    minimumNode: MIN_MAJOR,
    launcher: { bin: state.current.bin, version: versionString(state.current.version) },
    mvosNode: process.env.MVOS_NODE || null,
    chosen: state.choice.node ? { bin: state.choice.node.bin, version: versionString(state.choice.node.version) } : null,
    reason: state.choice.reason,
    found: all.map(function (c) {
      return { bin: c.bin, version: versionString(c.version), source: c.source };
    }),
  };
  if (asJson) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    var out = [];
    out.push("MemoValeOS doctor");
    out.push("  vault         " + report.vault + (report.osVersion ? "  (" + report.osVersion + ")" : ""));
    out.push("  needs Node    " + MIN_MAJOR + " or newer");
    out.push("  launcher Node " + report.launcher.version + "  " + report.launcher.bin);
    out.push("  MVOS_NODE     " + (report.mvosNode || "not set"));
    out.push("  tools run on  " + (report.chosen ? report.chosen.version + "  " + report.chosen.bin : "NOTHING SUITABLE") + "  — " + report.reason);
    out.push("  found:");
    for (var i = 0; i < report.found.length; i++) out.push("    " + report.found[i].version + "  " + report.found[i].bin + "  (" + report.found[i].source + ")");
    if (!report.found.length) out.push("    (none)");
    process.stdout.write(out.join("\n") + "\n");
  }
  return report.chosen ? 0 : 3;
}

function usage() {
  return [
    "Usage:",
    '  node "' + path.join(TOOLS_DIR, "mv.cjs") + '" <tool> [args...]',
    '  node "' + path.join(TOOLS_DIR, "mv.cjs") + '" doctor [--json]',
    "Tools: " + toolNames().join(", "),
  ].join("\n");
}

function main(argv) {
  var first = argv[0];
  if (!first || first === "--help" || first === "-h") {
    process.stdout.write(usage() + "\n");
    return first ? 0 : 2;
  }
  if (first === "doctor") return doctor(argv.indexOf("--json") !== -1);

  var name = first.replace(/\.mjs$/, "");
  if (toolNames().indexOf(name) === -1) {
    process.stderr.write("Unknown tool `" + first + "`.\n" + usage() + "\n");
    return 2;
  }
  var state = resolveChoice(process.env);
  if (!state.choice.node) {
    process.stderr.write(noNodeMessage(state) + "\n");
    return 3;
  }
  var r = cp.spawnSync(state.choice.node.bin, [path.join(TOOLS_DIR, name + ".mjs")].concat(argv.slice(1)), { stdio: "inherit" });
  if (r.error) {
    process.stderr.write("Could not start " + state.choice.node.bin + ": " + r.error.message + "\n");
    return 3;
  }
  return r.status === null ? 1 : r.status;
}

module.exports = {
  MIN_MAJOR: MIN_MAJOR,
  parseVersion: parseVersion,
  compareVersions: compareVersions,
  findCandidates: findCandidates,
  chooseNode: chooseNode,
  toolNames: toolNames,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
