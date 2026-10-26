#!/usr/bin/env node
/*
 * context-metrics.mjs
 *
 * Measures how efficiently an assistant moved through this knowledge base:
 * what it spent, how loaded its context became, which files it opened, and how
 * much of each file it actually pulled in.
 *
 * Reads Claude Code session transcripts. Nothing is sent anywhere.
 *
 * Usage — the vault root is found from this file's own location, not from the
 * working directory, so this runs correctly from anywhere:
 *   node "Knowledge-OS/Tools/context-metrics.mjs"
 *   node "Knowledge-OS/Tools/context-metrics.mjs" --all
 *   node "Knowledge-OS/Tools/context-metrics.mjs" --session <id> --json
 *   node "Knowledge-OS/Tools/context-metrics.mjs" --write
 *
 * Options:
 *   --session <id>      one session by id (default: the most recent that touched this vault)
 *   --all               every session that touched this vault
 *   --transcripts <dir> override the transcripts root
 *   --sessions <dir>    where --write puts per-session JSON dumps
 *                       (default: Metrics/sessions/ inside the vault;
 *                       MEMOVALE_SESSIONS_DIR overrides the default too)
 *   --json              machine-readable output
 *   --write             append a snapshot row to Metrics/Context-Metrics.md,
 *                       and the full per-session JSON to <sessions-dir>/<id>.json
 *   --label <class>     optional free-text tag stored in the snapshot row
 */

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, statSync, realpathSync } from "node:fs";
import { join, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

/* Structural, not cwd-based — see validate-vault.mjs for why. If the caller's
 * cwd is a parent project's root rather than the vault, path categorization
 * below (governance/project/evidence/maintenance) would silently misclassify
 * every file instead of failing loudly, which is worse than a crash. */
const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const argv = process.argv.slice(2);

const flag = (name) => argv.includes(name);
const value = (name) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
};

const JSON_OUT = flag("--json");
const WRITE = flag("--write");
const ALL = flag("--all");
const ONE_SESSION = value("--session");
const LABEL = value("--label");
const TRANSCRIPTS = value("--transcripts") || join(homedir(), ".claude", "projects");

/* Outside both Knowledge-OS and Project-OS, not beside the tool that writes
 * it: this is a generated metrics artifact, not project knowledge, but
 * `type: log` is a project/operational type and validate-vault.mjs's
 * project-type-inside-knowledge-os rule now forbids exactly that combination
 * inside Knowledge-OS (the same way meta-type-outside-knowledge-os forbids
 * the reverse). A sibling of Knowledge-OS and Project-OS, at the vault root,
 * is outside both governed trees, so the schema this file's content follows
 * simply does not apply to where it lives. */
const LOG_NOTE = join("Metrics", "Context-Metrics.md");

/* ------------------------------------------------------------------ paths */

const vaultKey = VAULT.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();

/* `.claude/commands/` is the agent's interface to the OS and ships in
 * os-manifest alongside Rules and Protocols, but it does not live inside the
 * vault: in a standalone clone it sits at the vault root, and when MemoValeOS
 * is embedded in a larger project it sits one level above. Either way an
 * absolute path to it fails the vaultKey prefix test and lands in `evidence`
 * — the bucket that means "source code being worked on". Resolve it the same
 * way validate-vault.mjs's findClaudeDir does, so OS work stays OS work. */
const claudeKeys = [vaultKey + "/.claude", vaultKey.replace(/\/[^/]+$/, "") + "/.claude"];

/* Resolve a raw tool argument to a stable identity. The same file arrives as an
 * absolute Windows path from Read and as a vault-relative path from the MCP
 * tools; counted separately they hide every repeat read. */
/* Before a56b29a (2026-09-17) the trees were `Knowledge OS/` and `Project OS/`.
 * A transcript from then still names them that way, and without this every read
 * in it lands in `other`: re-measuring an old session reported zero knowledge
 * reads where the row written at the time had counted them. */
const legacyTreeName = (key) => key.replace(/^(Knowledge|Project) OS\//, "$1-OS/");

function resolvePath(raw) {
  if (!raw || typeof raw !== "string") return null;
  const p = raw.replace(/\\/g, "/").replace(/\/+$/, "");
  const lower = p.toLowerCase();

  if (lower === vaultKey) return null;
  if (lower.startsWith(vaultKey + "/")) {
    return { inVault: true, key: legacyTreeName(p.slice(vaultKey.length + 1)) };
  }
  for (const ck of claudeKeys) {
    if (lower === ck) return null;
    if (lower.startsWith(ck + "/")) return { inVault: true, key: ".claude/" + p.slice(ck.length + 1) };
  }

  if (/^[a-z]:\//i.test(p) || p.startsWith("/")) {
    /* An absolute path that is not under VAULT but ends in `.md` is almost
     * always the same vault seen from a different working tree — a control
     * copy, a second clone, a moved checkout. categorize() would file it
     * under `evidence` (source code), silently moving knowledge reads into
     * the bucket that means the opposite. This has already happened once,
     * in session 5838ed23, and was caught only by reading the transcript by
     * hand. Flag it rather than guessing which vault it belongs to. */
    return { inVault: false, key: lower, suspectVaultNote: lower.endsWith(".md") };
  }
  // Already relative — the MCP tools address the vault this way.
  return { inVault: true, key: legacyTreeName(p) };
}

/* `maintenance` is work on the operating system itself rather than use of it.
 * Keeping those reads out of the efficiency figures is what stops a session
 * spent building the system from looking like catastrophically wasteful
 * knowledge work.
 *
 * For writes, that distinction applies to all of Knowledge-OS, not just
 * Tools/: editing Rules/, Schema/, or Protocols/ is building the system too.
 * Reads keep the finer split, because reading governance to follow it during
 * project work is normal use, not maintenance. */
function categorize(resolved, intent) {
  if (!resolved) return null;
  if (!resolved.inVault) return "evidence";
  const rel = resolved.key;
  if (rel.startsWith("Knowledge-OS/")) {
    if (intent === "write" || rel.startsWith("Knowledge-OS/Tools/")) return "maintenance";
    return "governance";
  }
  /* `.claude/commands/` is part of the operating system, not of the project —
   * it is the agent's interface to it, and it ships in os-manifest alongside
   * Rules and Protocols. Editing a command during a run is work on the system
   * and belongs in `maintenance`; reading one to follow it is ordinary use,
   * the same split Knowledge-OS gets above. Without this the whole agent
   * interface lands in `other` and C3 under-reports every OS change made
   * during a supposedly frozen run. */
  if (rel.startsWith(".claude/")) {
    return intent === "write" ? "maintenance" : "governance";
  }
  if (rel.startsWith("Project-OS/")) return "project";
  return "other";
}

/* ------------------------------------------------------------------ tools */

function toolIntent(name = "") {
  if (/^(Read|NotebookRead)$/.test(name)) return "read";
  if (/get_vault_file|get_note_outline|get_periodic_note|get_active_file/.test(name)) return "read";
  if (/^(Edit|Write|NotebookEdit)$/.test(name)) return "write";
  if (/patch_vault_file|set_note_property|create_vault_|append_to_|search_and_replace|rename_vault_file|delete_|update_active/.test(name)) return "write";
  if (/^(Grep|Glob)$/.test(name)) return "search";
  if (/search_vault|list_vault_files|find_broken_links|find_orphaned_notes|list_property_values|get_backlinks|get_outgoing_links|list_tags/.test(name)) return "search";
  return "other";
}

/* Path arguments are not named consistently across tools: Read uses file_path,
 * the MCP readers use path or filename, renames use from/to. */
const PATH_KEYS = ["file_path", "path", "filename", "notebook_path", "from", "to"];

function pathsFrom(input = {}) {
  const out = [];
  for (const key of PATH_KEYS) {
    if (typeof input[key] === "string") out.push(input[key]);
  }
  return out;
}

/* The names of the governed trees — what makes a shell command recognisable as
 * a reach into the vault. Kept beside categorize(), which sorts those same
 * names into buckets: if the two drift apart, so does the answer to "did this
 * session work on the vault". */
const VAULT_DIR_NAMES = ["Knowledge-OS", "Project-OS", "Metrics"];

/* A session that works through Bash (`cat`, `sed`, `grep`) calls no file tool
 * at all, so its reaches into the vault land in no bucket and touchedVault
 * stays false. Under `/mv-close` in auto mode that is the norm, not the
 * exception: the session dropped out of selection entirely, the *previous*
 * session became "most recent", and --write overwrote its row — with a success
 * exit code and not one refusal along the way.
 *
 * What is recognised here is only the SIGN that "a command named a path inside
 * the vault", and nothing more. It deliberately does not feed the buckets: the
 * buckets measure reading discipline per file, and a `cat` charged to
 * `governance` would mix the measured with the guessed — an arbitrary command
 * line cannot be parsed down to a list of files. The sign is a weaker claim and
 * matches the coarse evidence behind it. Hence the asymmetry: the session makes
 * it into selection, but its traversal columns stay zero, and the report says
 * so out loud. */
export function bashTouchesVault(command, vaultName = vaultKey.split("/").pop()) {
  if (!command || typeof command !== "string") return false;
  const haystack = command.replace(/\\/g, "/");
  if (VAULT_DIR_NAMES.some((dir) => haystack.includes(dir + "/"))) return true;
  /* The vault's own directory name is taken separately: `MemoValeOS/Backlog.md`
   * names none of the governed trees, yet the path leads inside the vault. */
  return Boolean(vaultName) && haystack.includes(vaultName + "/");
}

/* The files a shell command reads, as far as its command line says.
 *
 * bashTouchesVault answers only "did the session reach the vault". That left
 * every session driven through the shell with Files 0 and Re-read "—", and the
 * README's "rules are not read, yet followed" rested on exactly those rows: the
 * instrument could not see the reads it was taken to have counted as zero.
 *
 * This is a heuristic and is kept apart from the file-tool figures for that
 * reason: the counts it feeds are their own columns, never added to Files or
 * Re-read. It recognises the common read verbs and takes their path-shaped
 * arguments; a pipeline, a variable or a glob is not resolved further. A missed
 * read is possible, a read invented from nothing is not — every path returned
 * was written on the command line. */
const SHELL_READ_VERBS = new Set([
  "cat", "head", "tail", "less", "more", "sed", "awk", "grep", "egrep", "rg", "wc", "type",
  "get-content", "gc", "select-string", "sls",
]);
/* Verbs whose first positional argument is a pattern or a script, not a file —
 * unless the pattern came through an option (`grep -e`, `Select-String -Pattern`). */
const SHELL_PATTERN_FIRST = new Set(["sed", "awk", "grep", "egrep", "rg", "select-string", "sls"]);
const SHELL_PATTERN_OPTIONS = new Set(["-e", "-f", "--regexp", "--file", "-pattern"]);
/* Options that consume the next token. A purely numeric next token is consumed
 * after any option (`head -n 20`), so only the non-numeric cases are listed. */
const SHELL_VALUE_OPTIONS = new Set([
  "-e", "-f", "--regexp", "--file", "-g", "--glob", "-t", "--type", "-pattern", "-encoding",
  "-delimiter", "-filter", "-include", "-exclude",
]);
const SHELL_PATH_OPTIONS = new Set(["-path", "-literalpath"]);
const SHELL_CD_VERBS = new Set(["cd", "set-location", "sl", "pushd"]);

/* Split on whitespace and on the unquoted separators `&& || ; |` and newlines,
 * keeping quoted text as one token. A backslash is kept as it is: on this
 * platform it is a path separator far more often than an escape. */
function shellSegments(command) {
  const segments = [];
  let tokens = [];
  let current = "";
  let inToken = false;
  let quote = null;
  const endToken = () => {
    if (inToken) tokens.push(current);
    current = "";
    inToken = false;
  };
  const endSegment = () => {
    endToken();
    if (tokens.length) segments.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inToken = true;
      continue;
    }
    if (ch === "\n" || ch === ";" || ch === "|" || (ch === "&" && command[i + 1] === "&")) {
      if ((ch === "|" || ch === "&") && command[i + 1] === ch) i++;
      endSegment();
      continue;
    }
    if (/\s/.test(ch)) {
      endToken();
      continue;
    }
    current += ch;
    inToken = true;
  }
  endSegment();
  return segments;
}

function looksLikePath(token) {
  if (!token || token.startsWith("-") || token.startsWith("$") || token.includes("$(")) return false;
  if (token === "/dev/null" || /^[0-9]*[<>]/.test(token)) return false;
  return /[\\/]/.test(token) || /\.[A-Za-z0-9]{1,8}$/.test(token);
}

/* Normalise to forward slashes, turn a Git Bash drive (`/g/Projects`) into a
 * Windows one, and anchor a relative path: to the directory the command `cd`-ed
 * into, or — when it starts with the vault's own name — to the vault. */
function anchorShellPath(token, cwd, vaultName) {
  const isAbsolute = (x) => /^[a-zA-Z]:\//.test(x) || x.startsWith("/");
  let p = token.replace(/\\/g, "/").replace(/^\/([a-zA-Z])\//, "$1:/").replace(/^(\.\/)+/, "");
  if (!isAbsolute(p) && cwd) p = cwd.replace(/\/+$/, "") + "/" + p;
  if (!isAbsolute(p) && vaultName && p.toLowerCase().startsWith(vaultName.toLowerCase() + "/")) {
    p = p.slice(vaultName.length + 1);
  }
  return p;
}

export function shellReadPaths(command, vaultName = VAULT.replace(/\\/g, "/").split("/").pop()) {
  if (!command || typeof command !== "string") return [];
  const out = [];
  let cwd = null;
  for (const tokens of shellSegments(command)) {
    let at = 0;
    // Leading `VAR=value` assignments are not the verb.
    while (at < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[at])) at++;
    const verb = (tokens[at] ?? "").toLowerCase();
    const args = tokens.slice(at + 1);

    if (SHELL_CD_VERBS.has(verb)) {
      const target = args.find((a) => !a.startsWith("-"));
      if (target) cwd = anchorShellPath(target, cwd, null);
      continue;
    }
    if (!SHELL_READ_VERBS.has(verb)) continue;

    const patternByOption = args.some((a) => SHELL_PATTERN_OPTIONS.has(a.toLowerCase()));
    let skipPattern = SHELL_PATTERN_FIRST.has(verb) && !patternByOption;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const lower = arg.toLowerCase();
      if (SHELL_PATH_OPTIONS.has(lower)) {
        if (args[i + 1] !== undefined) out.push(anchorShellPath(args[++i], cwd, vaultName));
        continue;
      }
      if (arg.startsWith("-")) {
        if (SHELL_VALUE_OPTIONS.has(lower) || /^[+-]?\d+$/.test(args[i + 1] ?? "")) i++;
        continue;
      }
      // A bare redirection operator takes its target with it.
      if (/^[0-9]*[<>]{1,2}&?$/.test(arg)) {
        i++;
        continue;
      }
      if (skipPattern) {
        skipPattern = false;
        continue;
      }
      if (looksLikePath(arg)) out.push(anchorShellPath(arg, cwd, vaultName));
    }
  }
  return out;
}

/* The files a shell command writes, as far as its command line says.
 *
 * Until os-v9 a write counted only when a file tool made it. On the owner's
 * working project part of a session's edits to Current Context and to a Task
 * note went through python, and the figure that should have shown that no
 * session ever wrote Architecture or Research could not see those writes at
 * all. The rule of shellReadPaths holds here too: a missed write is possible,
 * an invented one is not — every path returned was written in the command.
 *
 * Recognised: `>` and `>>` (not `2>`), `tee`, `sed -i`, the destination of
 * `cp`/`mv`, PowerShell's `Set-Content`/`Add-Content`/`Out-File` and the
 * destination of `Copy-Item`/`Move-Item`, and a literal path a script opens for
 * writing — Python's `open(p, 'w')` and `Path(p).write_text(`, Node's
 * `writeFileSync(p`. A heredoc's body is text rather than commands and its
 * lines are skipped; the script forms are looked for across the whole
 * command, because a heredoc is exactly where they live. */
const SHELL_CONTENT_VERBS = new Set(["set-content", "add-content", "out-file"]);
const SHELL_COPY_VERBS = new Set(["cp", "mv", "copy-item", "move-item", "cpi", "mi"]);
const SHELL_WRITE_PATH_OPTIONS = new Set(["-path", "-literalpath", "-filepath", "-destination"]);
const SHELL_WRITE_VALUE_OPTIONS = new Set(["-value", "-encoding", "-inputobject", "-width", "-filter", "-include", "-exclude"]);
/* `cp -t <dir> <files>`: the destination is a directory and the files keep
 * their names, so no path on the line is the one written. Taking nothing is
 * the honest answer. */
const SHELL_TARGET_DIR_OPTIONS = new Set(["-t", "--target-directory"]);
const SCRIPT_WRITES = [
  /\bopen\(\s*r?(["'])([^"'\n]+)\1\s*,\s*r?(["'])[^"'\n]*[wax][^"'\n]*\3/g,
  /\bPath\(\s*r?(["'])([^"'\n]+)\1\s*\)\s*\.write_(?:text|bytes)\(/g,
  /\bwriteFileSync\(\s*(["'`])([^"'`\n]+)\1/g,
];

export function shellWritePaths(command, vaultName = VAULT.replace(/\\/g, "/").split("/").pop()) {
  if (!command || typeof command !== "string") return [];
  const out = [];
  let cwd = null;
  const take = (token) => {
    if (looksLikePath(token)) out.push(anchorShellPath(token, cwd, vaultName));
  };

  let heredocEnd = null;
  for (const tokens of shellSegments(command)) {
    if (heredocEnd !== null) {
      if (tokens.length === 1 && tokens[0] === heredocEnd) heredocEnd = null;
      continue;
    }

    // Redirections first: they write whatever the verb is.
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      const heredoc = t.match(/^<<(?!<)-?(.*)$/);
      if (heredoc) heredocEnd = heredoc[1].replace(/^\\/, "") || tokens[i + 1] || null;
      else if (/^(1|&)?>{1,2}$/.test(t)) take(tokens[++i] ?? "");
      else {
        const attached = t.match(/^(?:1|&)?>{1,2}([^>&].*)$/);
        if (attached) take(attached[1]);
      }
    }

    let at = 0;
    while (at < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[at])) at++;
    const verb = (tokens[at] ?? "").toLowerCase();
    const args = tokens.slice(at + 1);

    if (SHELL_CD_VERBS.has(verb)) {
      const target = args.find((a) => !a.startsWith("-"));
      if (target) cwd = anchorShellPath(target, cwd, null);
      continue;
    }

    // The positional arguments, with each option's value and each redirection taken out.
    const positional = [];
    let named = null;
    let targetDir = false;
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      const lower = arg.toLowerCase();
      if (/^[0-9&]*[<>]/.test(arg)) {
        if (/^[0-9&]*[<>]{1,2}&?$/.test(arg)) i++;
        continue;
      }
      if (SHELL_WRITE_PATH_OPTIONS.has(lower)) {
        named = args[++i] ?? null;
        continue;
      }
      if (SHELL_TARGET_DIR_OPTIONS.has(lower)) {
        targetDir = true;
        i++;
        continue;
      }
      if (arg.startsWith("-")) {
        if (SHELL_WRITE_VALUE_OPTIONS.has(lower) || (verb === "sed" && SHELL_PATTERN_OPTIONS.has(lower))) i++;
        continue;
      }
      positional.push(arg);
    }

    if (verb === "tee") positional.forEach(take);
    else if (verb === "sed" && args.some((a) => /^(-i|--in-place)/.test(a))) {
      const scriptByOption = args.some((a) => SHELL_PATTERN_OPTIONS.has(a.toLowerCase()));
      positional.slice(scriptByOption ? 0 : 1).forEach(take);
    } else if (SHELL_CONTENT_VERBS.has(verb)) take(named ?? positional[0] ?? "");
    else if (SHELL_COPY_VERBS.has(verb) && !targetDir) {
      take(named ?? (positional.length > 1 ? positional[positional.length - 1] : ""));
    }
  }

  for (const re of SCRIPT_WRITES) {
    for (const m of command.matchAll(re)) take(m[2]);
  }
  return out;
}

/* What kind of project knowledge a written note is — the question C10 asks of
 * reads, asked of writes. A Task note growing while Architecture and Research
 * never change is the failure os-v9 was built against, and it is invisible in
 * a count of writes that does not say what was written.
 *
 * The note's own `type` decides, read when the metrics are taken; a note
 * deleted or renamed since falls back to its folder. The uncertainty ledger is
 * found by `uncertaint` in its path, as validate-vault.mjs finds it, and
 * Current Context by its folder: both are `index` notes, and an index edit is
 * otherwise `other`. An Epic counts with Tasks — both track work, neither is
 * knowledge the next Task will read. Templates are not counted. */
const KIND_BY_TYPE = {
  task: "task",
  epic: "task",
  finding: "finding",
  research: "research",
  architecture: "architecture",
  decision: "decision",
  product: "product",
};
const KIND_BY_FOLDER = [
  [/\/(Tasks|Epics)\//i, "task"],
  [/\/Findings\//i, "finding"],
  [/Architecture\//i, "architecture"],
  [/Research\//i, "research"],
  [/Decisions?\//i, "decision"],
  [/Product\//i, "product"],
];
export const KINDS = ["task", "finding", "research", "architecture", "decision", "product", "uncertainty", "context", "other"];

const typeCache = new Map();
function frontmatterType(key) {
  if (typeCache.has(key)) return typeCache.get(key);
  let type = null;
  try {
    const head = readFileSync(join(VAULT, key), "utf8").slice(0, 4000);
    const fm = head.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    type = fm?.[1].match(/^type:\s*["']?([A-Za-z-]+)/m)?.[1].toLowerCase() ?? null;
  } catch {
    /* gone since the session: the folder decides */
  }
  typeCache.set(key, type);
  return type;
}

export function noteKind(key, typeOf = frontmatterType) {
  if (typeof key !== "string" || !key.startsWith("Project-OS/") || !key.toLowerCase().endsWith(".md")) return null;
  if (key.startsWith("Project-OS/Templates/")) return null;
  if (/uncertaint/i.test(key)) return "uncertainty";
  if (/\/Context\/[^/]+$/.test(key)) return "context";
  const type = typeOf(key);
  if (type) return KIND_BY_TYPE[type] ?? "other";
  for (const [re, kind] of KIND_BY_FOLDER) if (re.test(key)) return kind;
  return "other";
}

/* The Writes cell: distinct notes written, by kind, in a fixed order. `0` is a
 * measured nothing; the `—` that migrateHeader puts in older rows is an absent
 * measurement, and the two must not look alike. */
const KIND_LETTERS = { task: "T", finding: "F", research: "R", architecture: "A", decision: "D", product: "P", uncertainty: "U", context: "C", other: "O" };
export function writesCell(byKind = {}) {
  const parts = KINDS.filter((k) => byKind[k]).map((k) => `${KIND_LETTERS[k]}${byKind[k]}`);
  return parts.length ? parts.join(" ") : "0";
}

/* ---------------------------------------------------------------- parsing */

function readJsonl(file) {
  const records = [];
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    return records;
  }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // A partially flushed final line is normal on a live session.
    }
  }
  return records;
}

function analyseRecords(records) {
  const requests = new Map(); // message.id -> usage, deduped
  const models = new Set();
  const results = new Map(); // tool_use_id -> toolUseResult
  const calls = [];
  let retries = 0;
  let first = null;
  let last = null;
  let errorSincePrevious = false;

  for (const r of records) {
    if (r.timestamp) {
      if (!first || r.timestamp < first) first = r.timestamp;
      if (!last || r.timestamp > last) last = r.timestamp;
    }

    /* `errorSincePrevious` is consumed by the next request recorded below. A
     * failed request is retried, and the retry does not land on the same cache
     * entry — so an error between two requests is a candidate explanation for
     * a prefix break that no idle time accounts for. */
    if (r.type === "system" && r.subtype === "api_error") {
      retries++;
      errorSincePrevious = true;
    }

    if (r.type === "user") {
      const content = r.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "tool_result" && block.tool_use_id) {
            results.set(block.tool_use_id, r.toolUseResult ?? null);
          }
        }
      }
      continue;
    }

    if (r.type !== "assistant") continue;

    const msg = r.message;
    if (!msg) continue;
    if (msg.model && !msg.model.startsWith("<")) models.add(msg.model);

    /* Claude Code writes one line per content block and copies `usage` onto
     * every one of them. Summing the raw lines overcounts several-fold. */
    if (msg.id && msg.usage && !requests.has(msg.id)) {
      requests.set(msg.id, {
        usage: msg.usage,
        at: r.timestamp ?? null,
        model: msg.model ?? null,
        errorSincePrevious,
      });
      errorSincePrevious = false;
    }

    for (const block of msg.content ?? []) {
      if (block?.type !== "tool_use") continue;
      calls.push({ id: block.id, name: block.name, input: block.input ?? {} });
    }
  }

  return { requests, models, results, calls, retries, first, last };
}

/* `files` counts every touch; `readFiles` counts reads only. Repeats are drawn
 * from `readFiles`, because re-opening a file to read it again is wasted
 * context, while editing one ten times is simply the work.
 *
 * `shellFiles` / `shellReads` are reads parsed from Bash and PowerShell command
 * lines (shellReadPaths). They never enter `files` or `readFiles`: those are
 * reported by a file tool, these are inferred from text. `shellWrites` is the
 * same for writes (shellWritePaths), kept apart from `writes` for the same
 * reason. */
function emptyBucket() {
  return {
    files: new Map(),
    readFiles: new Map(),
    reads: 0,
    writes: 0,
    searches: 0,
    covered: 0,
    coverageSamples: 0,
    shellFiles: new Map(),
    shellReads: 0,
    shellWrites: 0,
  };
}

/* Project-OS notes written, by either route: key -> Set of "tool" | "shell". */
function noteWritten(written, key, via) {
  if (!written.has(key)) written.set(key, new Set());
  written.get(key).add(via);
}

function summarise(parsed) {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 };
  const contextLoads = [];
  /* The same three numbers `contextLoads` adds together, kept apart and in
   * order. The sum answers "how loaded did the context get"; it cannot answer
   * "how much of that load was paid for twice", because once input, cacheRead
   * and cacheCreation are one number, a context that grew is indistinguishable
   * from a context that was reprocessed. analyseCache reads this instead.
   *
   * `parsed.requests` is a Map keyed by message.id, so insertion order is
   * transcript order and no second pass is needed. */
  const cacheSeries = [];

  for (const r of parsed.requests.values()) {
    const u = r.usage;
    const input = u.input_tokens ?? 0;
    const cacheRead = u.cache_read_input_tokens ?? 0;
    const cacheCreation = u.cache_creation_input_tokens ?? 0;
    usage.input += input;
    usage.output += u.output_tokens ?? 0;
    usage.cacheRead += cacheRead;
    usage.cacheCreation += cacheCreation;
    contextLoads.push(input + cacheRead + cacheCreation);
    cacheSeries.push({
      input,
      cacheRead,
      cacheCreation,
      at: r.at,
      model: r.model,
      errorSincePrevious: r.errorSincePrevious,
    });
  }

  const buckets = {
    governance: emptyBucket(),
    project: emptyBucket(),
    evidence: emptyBucket(),
    maintenance: emptyBucket(),
    other: emptyBucket(),
  };
  let unscopedSearches = 0;
  /* Markdown files addressed by absolute path from outside VAULT — see
   * resolvePath. Reported rather than silently bucketed as evidence. */
  const foreignNotes = new Set();
  /* Counted before the buckets are sorted: a shell tool yields intent === "other"
   * and would be dropped by the next line along with everything it said about
   * the vault. PowerShell is a shell too — until 2026-10-13 only Bash was
   * looked at, and a session reading through PowerShell was invisible twice. */
  let bashVaultTouches = 0;
  const written = new Map();

  for (const call of parsed.calls) {
    const intent = toolIntent(call.name);
    if (call.name === "Bash" || call.name === "PowerShell") {
      const command = call.input?.command;
      if (bashTouchesVault(command)) bashVaultTouches++;
      for (const raw of shellReadPaths(command)) {
        const resolved = resolvePath(raw);
        const cat = categorize(resolved, "read");
        if (!cat || !buckets[cat]) continue;
        buckets[cat].shellReads++;
        buckets[cat].shellFiles.set(resolved.key, (buckets[cat].shellFiles.get(resolved.key) ?? 0) + 1);
      }
      for (const raw of shellWritePaths(command)) {
        const resolved = resolvePath(raw);
        const cat = categorize(resolved, "write");
        if (!cat || !buckets[cat]) continue;
        buckets[cat].shellWrites++;
        if (cat === "project") noteWritten(written, resolved.key, "shell");
      }
    }
    if (intent === "other") continue;

    const paths = pathsFrom(call.input);

    /* A path-less search (e.g. Grep with no `path`) still reads the whole
     * vault's worth of names looking for a match — it just doesn't say
     * which file it touched, so it would otherwise vanish from every
     * bucket instead of being counted at all. */
    if (intent === "search" && paths.length === 0) {
      unscopedSearches++;
      continue;
    }

    for (const raw of paths) {
      const resolved = resolvePath(raw);
      if (resolved?.suspectVaultNote) foreignNotes.add(resolved.key);
      const cat = categorize(resolved, intent);
      if (!cat || !buckets[cat]) continue;

      const bucket = buckets[cat];
      bucket.files.set(resolved.key, (bucket.files.get(resolved.key) ?? 0) + 1);

      if (intent === "read") {
        bucket.reads++;
        bucket.readFiles.set(resolved.key, (bucket.readFiles.get(resolved.key) ?? 0) + 1);
      } else if (intent === "write") {
        bucket.writes++;
        if (cat === "project") noteWritten(written, resolved.key, "tool");
      } else if (intent === "search") bucket.searches++;

      // Only the native Read reports how much of the file it pulled in.
      if (intent === "read") {
        const result = parsed.results.get(call.id);
        const file = result?.file;
        if (file && file.totalLines > 0 && typeof file.numLines === "number") {
          bucket.covered += file.numLines / file.totalLines;
          bucket.coverageSamples++;
        }
      }
    }
  }

  return {
    usage,
    contextLoads,
    cacheSeries,
    buckets,
    unscopedSearches,
    foreignNotes: [...foreignNotes],
    bashVaultTouches,
    written,
  };
}

/* The Project-OS notes a session wrote, each with its kind and the route that
 * wrote it, and the count of distinct notes per kind — files, not edits:
 * editing one Task ten times is still one Task written. */
export function knowledgeWrites(written, kindOf = noteKind) {
  const byKind = {};
  const notes = [];
  for (const [file, via] of written) {
    const kind = kindOf(file);
    if (!kind) continue;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
    notes.push({ file, kind, via: [...via].sort() });
  }
  notes.sort((a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || a.file.localeCompare(b.file));
  return { byKind, notes };
}

function bucketStats(bucket) {
  let repeats = 0;
  let repeatedFiles = 0;
  for (const count of bucket.readFiles.values()) {
    if (count > 1) {
      repeats += count - 1;
      repeatedFiles++;
    }
  }
  const touches = [...bucket.files.values()].reduce((a, b) => a + b, 0);
  const top = [...bucket.readFiles.entries()]
    .filter(([, count]) => count > 1)
    .sort((a, b) => b[1] - a[1])
    .map(([file, count]) => ({ file, count }));

  /* The full per-file map, not just the repeats. `top` answers "what did this
   * session re-read"; C10 asks a different question — which *kinds* of note
   * the agent reaches for — and that cannot be answered from repeats alone,
   * nor reconstructed later from a row in the journal. Dropping this map is
   * the one loss in this script that is not recoverable after the fact. */
  const files = [...bucket.files.entries()]
    .map(([file, touches]) => ({ file, touches, reads: bucket.readFiles.get(file) ?? 0 }))
    .sort((a, b) => b.touches - a.touches || a.file.localeCompare(b.file));

  let shellRepeats = 0;
  for (const count of bucket.shellFiles.values()) if (count > 1) shellRepeats += count - 1;
  const shellFiles = [...bucket.shellFiles.entries()]
    .map(([file, reads]) => ({ file, reads }))
    .sort((a, b) => b.reads - a.reads || a.file.localeCompare(b.file));

  return {
    shellReads: bucket.shellReads,
    shellWrites: bucket.shellWrites,
    shellFilesRead: bucket.shellFiles.size,
    shellRepeats,
    shellFiles,
    distinctFiles: bucket.files.size,
    filesRead: bucket.readFiles.size,
    touches,
    reads: bucket.reads,
    writes: bucket.writes,
    searches: bucket.searches,
    repeats,
    repeatedFiles,
    coverage: bucket.coverageSamples ? bucket.covered / bucket.coverageSamples : null,
    top,
    files,
  };
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

/* ------------------------------------------------------------- discovery */

function findSessions() {
  const found = [];
  if (!existsSync(TRANSCRIPTS)) return found;

  for (const slug of readdirSync(TRANSCRIPTS)) {
    const slugDir = join(TRANSCRIPTS, slug);
    let entries;
    try {
      if (!statSync(slugDir).isDirectory()) continue;
      entries = readdirSync(slugDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".jsonl")) continue;
      const sessionId = entry.replace(/\.jsonl$/, "");
      found.push({
        sessionId,
        slug,
        file: join(slugDir, entry),
        subagentDir: join(slugDir, sessionId, "subagents"),
      });
    }
  }
  return found;
}

function analyseSubagents(dir) {
  const agents = [];
  if (!existsSync(dir)) return agents;

  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(".jsonl")) continue;
    const parsed = analyseRecords(readJsonl(join(dir, entry)));
    const summary = summarise(parsed);

    let meta = {};
    const metaFile = join(dir, entry.replace(/\.jsonl$/, ".meta.json"));
    if (existsSync(metaFile)) {
      try {
        meta = JSON.parse(readFileSync(metaFile, "utf8"));
      } catch {
        meta = {};
      }
    }

    agents.push({
      id: entry.replace(/^agent-|\.jsonl$/g, ""),
      agentType: meta.agentType ?? null,
      spawnDepth: meta.spawnDepth ?? null,
      requests: parsed.requests.size,
      toolCalls: parsed.calls.length,
      usage: summary.usage,
      buckets: summary.buckets,
      unscopedSearches: summary.unscopedSearches,
      foreignNotes: summary.foreignNotes,
      bashVaultTouches: summary.bashVaultTouches,
      written: summary.written,
    });
  }
  return agents;
}

/* B19: what the prefix cache actually did this session.
 *
 * The hit rate is here for completeness, and it is not the interesting number:
 * measured across 35 sessions of this project it never left 94–99%, because
 * Claude Code keeps the prefix stable on its own and this system pushes only
 * `CLAUDE.md`. A metric that reads 97% every time teaches nothing.
 *
 * `prefixBreaks` is the number worth having. A request whose `cacheRead` is
 * LOWER than the previous request's has a shorter reusable prefix than the
 * request before it — something earlier in the conversation changed, so
 * everything after the change is processed again. It is rare (0–4% of requests)
 * and expensive: 54 such events across those same 35 sessions cost 27.3M tokens
 * of reprocessing, none of it visible in any figure this tool reported.
 *
 * Only requests that read cache at all are compared. A session opens with
 * `cacheRead: 0` on its first requests while the prefix is still being written,
 * and counting the rise out of zero as a break would report one on every
 * session — a break that is always present is not a signal.
 *
 * Each break is attributed to a cause. Measured over the same 35 sessions, the
 * break rate against the pause before the request is a step function, not a
 * slope: 0% under a minute, 14% at 15-30 minutes, then 100% in the 60-90 minute
 * band and 92-93% beyond it. That boundary is the cache's one-hour TTL, and
 * expiry accounts for 76% of all reprocessing. `api_error` (the request failed
 * and the retry did not land on the same cache entry) and a model switch
 * between requests explain three more events between them.
 *
 * Context compaction — the hypothesis this was expected to confirm — explains
 * none of it. The longest session in the record carries exactly one
 * `compact_boundary`, and twenty of its twenty-one breaks precede it.
 *
 * `unattributed` is left as its own bucket rather than folded into a guess.
 * Nineteen events (24% of cost) have no idle time, no error and no model
 * change; over half of that cost is in one 715-request session, which is too
 * few cases to separate a fourth mechanism from noise. */
const TTL_MINUTES = 60;

export function analyseCache(series) {
  if (!Array.isArray(series) || series.length === 0) return null;

  let input = 0;
  let cacheRead = 0;
  let cacheCreation = 0;
  for (const r of series) {
    input += r.input ?? 0;
    cacheRead += r.cacheRead ?? 0;
    cacheCreation += r.cacheCreation ?? 0;
  }
  const total = input + cacheRead + cacheCreation;
  if (total === 0) return null;

  let prefixBreaks = 0;
  let tokensReprocessed = 0;
  let worstBreak = null;
  let prev = null;
  const byCause = { ttlExpiry: 0, apiError: 0, modelSwitch: 0, unattributed: 0 };
  const costByCause = { ttlExpiry: 0, apiError: 0, modelSwitch: 0, unattributed: 0 };
  let longestIdleMinutes = 0;

  for (const [i, r] of series.entries()) {
    const read = r.cacheRead ?? 0;
    if (read === 0) continue; // Prefix not established yet, or no cache on this request.

    const idle = minutesBetween(prev?.at, r.at);
    if (idle !== null && idle > longestIdleMinutes) longestIdleMinutes = idle;

    if (prev !== null && read < prev.cacheRead) {
      const cost = prev.cacheRead - read + (r.cacheCreation ?? 0);
      prefixBreaks++;
      tokensReprocessed += cost;

      /* Ordered by how much each explains, so a break that could be read two
       * ways is attributed to the cause with the evidence behind it. */
      let cause;
      if (idle !== null && idle > TTL_MINUTES) cause = "ttlExpiry";
      else if (r.errorSincePrevious) cause = "apiError";
      else if (prev.model && r.model && prev.model !== r.model) cause = "modelSwitch";
      else cause = "unattributed";

      byCause[cause]++;
      costByCause[cause] += cost;

      if (!worstBreak || cost > worstBreak.cost) {
        worstBreak = {
          request: i,
          cost,
          droppedTo: read,
          droppedFrom: prev.cacheRead,
          cause,
          idleMinutes: idle === null ? null : Math.round(idle),
        };
      }
    }
    prev = { cacheRead: read, at: r.at, model: r.model };
  }

  return {
    requests: series.length,
    hitRate: cacheRead / total,
    creationShare: cacheCreation / total,
    readToCreateRatio: cacheCreation ? cacheRead / cacheCreation : null,
    prefixBreaks,
    tokensReprocessed,
    byCause,
    costByCause,
    longestIdleMinutes: Math.round(longestIdleMinutes),
    worstBreak,
  };
}

function minutesBetween(a, b) {
  if (!a || !b) return null;
  const ms = new Date(b) - new Date(a);
  return Number.isFinite(ms) ? ms / 60000 : null;
}

/* B6: read `.claude/budget-audit.jsonl`, written by the PreToolUse hook, and
 * reduce it to the few numbers that say whether the reading discipline in
 * `Context Selection Protocol` §2 was followed this session.
 *
 * The headline number is `undeclared`, not `outside`. Reading outside a
 * declared budget is a judgement call the protocol explicitly allows ("reading
 * beyond the budget requires a reason"); never declaring one at all is the
 * rule simply not being followed, and that is what went unmeasured through
 * twelve tasks while BEHAV-7 carried ⚠️.
 *
 * `subagentReads` is here because the protocol claims delegating the search
 * does not delegate the budget. The hook records `agent_type` on a subagent's
 * calls and nothing on the main session's, which makes the claim checkable.
 *
 * `undeclared` is not comparable across the 2026-09-14 boundary. Before it,
 * `budget.json` was never removed, so a session's opening reads were scored
 * against whatever the previous Task had declared and counted as `declared`
 * however stale it was — the audit log holds 125 rows and not one `undeclared`.
 * Since `/mv-close` deletes the file, the reads before a session declares its
 * own budget count as `undeclared`, which is what they always were. Expect the
 * number to rise; the rise is the old measurement being wrong, not the
 * discipline decaying. */
/* Was this budget already spent? `Context Selection Protocol` §2 requires
 * rewriting `.claude/budget.json` when the budget legitimately changes, and
 * warns that a budget carried over from the previous Task "would score this
 * Task's reads against a boundary drawn for different work". Nothing checked
 * it, and it has already happened: the live budget declared T18 while T18 was
 * `done` and T20 was next, so every read logged `withinBudget: false` against a
 * boundary drawn for finished work.
 *
 * The Task's own `status` is the authority — the same field the closing ritual
 * and `/mv-resume` look up. `Current Context`'s prose says the same thing in
 * sentences, but a check that depends on how a sentence is phrased reports a
 * problem whenever the wording moves, and a warning that fires wrongly is one
 * that gets ignored. */
/* A budget's `task` names its Task by file name (`T14-Function-Analyzer`), but
 * older declarations used a label (`T14 — Function Analyzer`) that matched no
 * file, so every stale budget read as a free-text one and `staleBudgets` was
 * empty by construction. The leading Task id is enough to find the file. */
function taskFileFor(taskName) {
  const dir = join(VAULT, "Project-OS", "03-Development", "Tasks");
  const exact = join(dir, `${taskName.trim()}.md`);
  try {
    readFileSync(exact);
    return exact;
  } catch {
    /* fall through to the id */
  }
  const id = taskName.trim().match(/^(T\d+)\b/i)?.[1];
  if (!id) return null;
  try {
    const hit = readdirSync(dir).find((n) => n.toUpperCase().startsWith(id.toUpperCase() + "-") && n.endsWith(".md"));
    return hit ? join(dir, hit) : null;
  } catch {
    return null;
  }
}

export function isTaskDone(taskName) {
  if (typeof taskName !== "string" || !taskName.trim()) return false;
  const file = taskFileFor(taskName);
  if (!file) return false; // No such Task file — a free-text budget label, not a stale one.
  return /^status:\s*(done|cancelled)\s*$/m.test(readFileSync(file, "utf8"));
}

function analyseBudget(sessionId) {
  /* The hook writes under the project root's `.claude/`: the vault's parent
   * when the vault is embedded, the vault itself when it is a standalone
   * clone. Looking only at the parent made the standalone layout's reading
   * discipline invisible. Same two places as findClaudeDir() in the validator. */
  let lines = null;
  for (const root of [dirname(VAULT), VAULT]) {
    try {
      lines = readFileSync(join(root, ".claude", "budget-audit.jsonl"), "utf8").split("\n").filter(Boolean);
      break;
    } catch {
      /* try the other layout */
    }
  }
  if (lines === null) return null; // Hook not installed, or nothing recorded yet.

  const rows = [];
  for (const line of lines) {
    try {
      const row = JSON.parse(line);
      if (row.session === sessionId) rows.push(row);
    } catch {
      // A truncated final line is normal if the session is still running.
    }
  }
  if (rows.length === 0) return null;

  const tasks = [...new Set(rows.map((r) => r.task).filter(Boolean))];
  return {
    staleBudgets: tasks.filter(isTaskDone),
    reads: rows.length,
    declared: rows.filter((r) => r.declared).length,
    undeclared: rows.filter((r) => !r.declared).length,
    withinBudget: rows.filter((r) => r.withinBudget === true).length,
    outsideBudget: rows.filter((r) => r.withinBudget === false).length,
    subagentReads: rows.filter((r) => r.agent).length,
    subagentUndeclared: rows.filter((r) => r.agent && !r.declared).length,
    tasks,
  };
}

function analyseSession(session) {
  const records = readJsonl(session.file);
  const parsed = analyseRecords(records);
  const summary = summarise(parsed);
  const subagents = analyseSubagents(session.subagentDir);

  // Fold subagent traversal into the session view: that is where most of the
  // knowledge base actually gets read.
  const merged = {};
  for (const cat of Object.keys(summary.buckets)) {
    const bucket = emptyBucket();
    const sources = [summary.buckets[cat], ...subagents.map((a) => a.buckets[cat])];
    for (const src of sources) {
      if (!src) continue;
      for (const [file, count] of src.files) bucket.files.set(file, (bucket.files.get(file) ?? 0) + count);
      for (const [file, count] of src.readFiles) bucket.readFiles.set(file, (bucket.readFiles.get(file) ?? 0) + count);
      bucket.reads += src.reads;
      bucket.writes += src.writes;
      bucket.searches += src.searches;
      bucket.covered += src.covered;
      bucket.coverageSamples += src.coverageSamples;
      for (const [file, count] of src.shellFiles) bucket.shellFiles.set(file, (bucket.shellFiles.get(file) ?? 0) + count);
      bucket.shellReads += src.shellReads;
      bucket.shellWrites += src.shellWrites;
    }
    merged[cat] = bucketStats(bucket);
  }

  const written = new Map();
  for (const source of [summary.written, ...subagents.map((a) => a.written)]) {
    for (const [file, via] of source ?? []) for (const v of via) noteWritten(written, file, v);
  }
  const knowledge = knowledgeWrites(written);

  const subUsage = subagents.reduce(
    (acc, a) => ({
      input: acc.input + a.usage.input,
      output: acc.output + a.usage.output,
      cacheRead: acc.cacheRead + a.usage.cacheRead,
      cacheCreation: acc.cacheCreation + a.usage.cacheCreation,
    }),
    { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  );

  const loads = summary.contextLoads;
  const vaultTouches =
    merged.governance.touches + merged.project.touches + merged.evidence.touches + merged.maintenance.touches;
  /* Subagents add up the same way usage and foreignNotes do above: a delegated
   * search is work done by the same session, and it reaches the vault on that
   * session's behalf. */
  const bashVaultTouches =
    summary.bashVaultTouches + subagents.reduce((a, ag) => a + (ag.bashVaultTouches ?? 0), 0);
  const unscopedSearches = summary.unscopedSearches + subagents.reduce((a, ag) => a + ag.unscopedSearches, 0);
  const foreignNotes = [...new Set([...summary.foreignNotes, ...subagents.flatMap((ag) => ag.foreignNotes ?? [])])];

  return {
    sessionId: session.sessionId,
    slug: session.slug,
    rawAssistantRecords: records.filter((r) => r.type === "assistant").length,
    requests: parsed.requests.size,
    retries: parsed.retries,
    models: [...parsed.models],
    first: parsed.first,
    last: parsed.last,
    usage: summary.usage,
    subagentUsage: subUsage,
    context: {
      first: loads.length ? loads[0] : 0,
      peak: loads.length ? Math.max(...loads) : 0,
      mean: loads.length ? Math.round(loads.reduce((a, b) => a + b, 0) / loads.length) : 0,
      p95: Math.round(percentile(loads, 95)),
    },
    buckets: merged,
    writesByKind: knowledge.byKind,
    writtenNotes: knowledge.notes,
    unscopedSearches,
    foreignNotes,
    cache: analyseCache(summary.cacheSeries),
    budget: analyseBudget(session.sessionId),
    subagents: subagents.map(({ buckets, written, ...rest }) => rest),
    touchedVault: vaultTouches > 0 || bashVaultTouches > 0,
    /* Kept apart from touchedVault because the report needs to tell "traversal
     * measured" from "session recognised by its command line": in the second
     * case the traversal columns are zeros, and that is an absent measurement
     * rather than a measured zero. */
    vaultTouchedOnlyViaBash: vaultTouches === 0 && bashVaultTouches > 0,
    bashVaultTouches,
  };
}

/* -------------------------------------------------------------- reporting */

const n = (x) => (x ?? 0).toLocaleString("en-US");
const pct = (x) => (x === null ? "—" : Math.round(x * 100) + "%");

function report(sessions) {
  for (const s of sessions) {
    const hours = s.first && s.last ? ((new Date(s.last) - new Date(s.first)) / 3600000).toFixed(1) : "?";

    console.log(`Session ${s.sessionId}`);
    console.log(`  slug        ${s.slug}`);
    console.log(`  span        ${s.first ?? "?"} → ${s.last ?? "?"}  (${hours} h)`);
    console.log(`  models      ${s.models.join(", ") || "—"}`);
    console.log(`  requests    ${n(s.requests)}   (${n(s.rawAssistantRecords)} raw records, deduped by message.id)`);
    if (s.retries) console.log(`  retries     ${n(s.retries)}`);
    console.log("");

    console.log("  Tokens                main            subagents");
    console.log(`    output          ${n(s.usage.output).padStart(12)}    ${n(s.subagentUsage.output).padStart(12)}`);
    console.log(`    input           ${n(s.usage.input).padStart(12)}    ${n(s.subagentUsage.input).padStart(12)}`);
    console.log(`    cache read      ${n(s.usage.cacheRead).padStart(12)}    ${n(s.subagentUsage.cacheRead).padStart(12)}`);
    console.log(`    cache creation  ${n(s.usage.cacheCreation).padStart(12)}    ${n(s.subagentUsage.cacheCreation).padStart(12)}`);
    console.log("");

    console.log("  Context load per request");
    console.log(`    first ${n(s.context.first).padStart(10)}   peak ${n(s.context.peak).padStart(10)}   mean ${n(s.context.mean).padStart(10)}   p95 ${n(s.context.p95).padStart(10)}`);
    console.log("");

    if (s.cache) {
      const c = s.cache;
      console.log("  Prefix cache (B19)");
      console.log(`    hit rate                ${pct(c.hitRate)}   (cache creation ${pct(c.creationShare)})`);
      /* Printed only when there is something to report. A line that reads zero
       * every time joins `stale` and QA's ⚠️ as something the eye learns to
       * skip, and then it is no longer there when it finally matters. */
      if (c.prefixBreaks) {
        console.log(`    prefix breaks           ${n(c.prefixBreaks)} of ${n(c.requests)} requests`);
        console.log(`    tokens reprocessed      ${n(c.tokensReprocessed)}   <- paid for twice`);
        const CAUSES = {
          ttlExpiry: "idle > 1h (cache TTL)",
          apiError: "api_error, request retried",
          modelSwitch: "model changed",
          unattributed: "unattributed",
        };
        for (const [key, label] of Object.entries(CAUSES)) {
          if (!c.byCause?.[key]) continue;
          console.log(`      ${label.padEnd(26)} ${String(c.byCause[key]).padStart(3)}   ${n(c.costByCause[key]).padStart(11)} tokens`);
        }
        if (c.worstBreak) {
          const w = c.worstBreak;
          const idle = w.idleMinutes === null ? "" : `, ${n(w.idleMinutes)} min idle`;
          console.log(`    worst at request #${w.request}: ${n(w.droppedFrom)} -> ${n(w.droppedTo)} cached, ${n(w.cost)} tokens (${w.cause}${idle})`);
        }
      }
      console.log("");
    }

    /* The zeros below are an absent measurement, not a measured zero, and
     * without this line they read as data. The session made it into selection
     * by its command line, but what it actually read was never reported by a
     * file tool. */
    if (s.vaultTouchedOnlyViaBash) {
      console.log(`  NOTE  vault reached only through the shell (${n(s.bashVaultTouches)} command(s));`);
      console.log("        the file-tool traversal below is unmeasured, not zero — see Shell reads.");
      console.log("");
    }

    console.log("  Traversal            files   touches    reads   writes  searches   re-read   coverage");
    for (const cat of ["governance", "project", "evidence", "maintenance", "other"]) {
      const b = s.buckets[cat];
      if (!b || b.touches === 0) continue;
      const label = cat === "maintenance" ? "maintenance*" : cat;
      console.log(
        `    ${label.padEnd(16)} ${String(b.distinctFiles).padStart(5)} ${String(b.touches).padStart(9)} ${String(b.reads).padStart(8)} ${String(b.writes).padStart(8)} ${String(b.searches).padStart(9)} ${String(b.repeats).padStart(9)} ${pct(b.coverage).padStart(10)}`
      );
    }
    if (s.buckets.maintenance.touches) {
      console.log("    * work on the operating system itself — excluded from efficiency below");
    }
    if (s.unscopedSearches) {
      console.log(`    unscoped searches (no path argument): ${n(s.unscopedSearches)}`);
    }
    if (s.foreignNotes?.length) {
      console.log(`    WARNING: ${s.foreignNotes.length} markdown file(s) addressed from outside this vault —`);
      console.log(`    counted as \`evidence\`, not as knowledge. Wrong working tree, or wrong --session?`);
      for (const f of s.foreignNotes.slice(0, 5)) console.log(`      ${f}`);
      if (s.foreignNotes.length > 5) console.log(`      ... and ${s.foreignNotes.length - 5} more`);
    }
    console.log("");

    /* Printed only when the shell read something: a block of zeros on every
     * file-tool session would be the line the eye learns to skip. */
    const shellCats = ["governance", "project", "maintenance"].filter((cat) => s.buckets[cat]?.shellReads || s.buckets[cat]?.shellWrites);
    if (shellCats.length) {
      console.log("  Shell reads and writes (parsed from Bash/PowerShell command lines — heuristic, not in Files or Re-read)");
      for (const cat of shellCats) {
        const b = s.buckets[cat];
        console.log(`    ${cat.padEnd(16)} ${String(b.shellFilesRead).padStart(5)} files ${String(b.shellReads).padStart(6)} reads ${String(b.shellRepeats).padStart(6)} repeats ${String(b.shellWrites).padStart(6)} writes`);
      }
      console.log("");
    }

    /* Printed only when the session wrote a project note: the question is what
     * kind of knowledge grew, and a Task-only line, session after session, is
     * the pattern this block exists to make visible. */
    if (s.writtenNotes?.length) {
      console.log(`  Knowledge written (Project-OS notes, distinct files)   ${writesCell(s.writesByKind)}`);
      for (const w of s.writtenNotes.slice(0, 12)) {
        console.log(`    ${w.kind.padEnd(13)} ${w.file}${w.via.includes("shell") ? "   (shell)" : ""}`);
      }
      if (s.writtenNotes.length > 12) console.log(`    ... and ${s.writtenNotes.length - 12} more`);
      console.log("");
    }

    const gov = s.buckets.governance;
    const proj = s.buckets.project;
    const distinct = gov.distinctFiles + proj.distinctFiles;
    const reads = gov.reads + proj.reads;
    const repeats = gov.repeats + proj.repeats;
    const spend = s.usage.output + s.subagentUsage.output;

    const reopened = [...gov.top, ...proj.top].sort((a, b) => b.count - a.count).slice(0, 8);
    if (reopened.length) {
      console.log("  Most re-read knowledge");
      for (const { file, count } of reopened) {
        console.log(`    ${String(count).padStart(3)}x  ${file}`);
      }
      console.log("");
    }

    if (s.budget) {
      const b = s.budget;
      console.log("  Reading discipline (B6 — Context Selection Protocol §2)");
      console.log(`    reads with a declared budget   ${n(b.declared)} of ${n(b.reads)}`);
      if (b.undeclared) {
        console.log(`    reads with NO budget declared  ${n(b.undeclared)}   <- the rule not followed`);
      }
      if (b.declared) {
        console.log(`    of the declared: inside ${n(b.withinBudget)}, outside ${n(b.outsideBudget)}`);
      }
      if (b.subagentReads) {
        console.log(`    delegated reads (subagents)    ${n(b.subagentReads)}, of which undeclared ${n(b.subagentUndeclared)}`);
      }
      if (b.tasks.length) console.log(`    budgets declared for           ${b.tasks.join(", ")}`);
      if (b.staleBudgets?.length) {
        console.log(`    WARNING: budget declared for a Task already \`done\`: ${b.staleBudgets.join(", ")}`);
        console.log(`    Reads above were scored against a boundary drawn for finished work.`);
      }
      console.log("");
    }

    console.log("  Efficiency (governance + project)");
    console.log(`    distinct files opened   ${n(distinct)}`);
    console.log(`    re-read share           ${reads ? Math.round((repeats / reads) * 100) + "%" : "—"}   (of ${n(reads)} reads)`);
    console.log(`    output tokens per file  ${distinct ? n(Math.round(spend / distinct)) : "—"}`);
    console.log(
      `    governance : project    ${proj.touches ? (gov.touches / proj.touches).toFixed(2) + " : 1" : gov.touches ? "all governance" : "—"}`
    );
    console.log("");

    if (s.subagents.length) {
      const depth = Math.max(...s.subagents.map((a) => a.spawnDepth ?? 0));
      const toolCalls = s.subagents.reduce((a, b) => a + b.toolCalls, 0);
      console.log(`  Subagents   ${s.subagents.length}   max depth ${depth}   tool calls ${n(toolCalls)}`);
      for (const a of s.subagents) {
        console.log(`    ${(a.agentType ?? "?").padEnd(18)} depth ${a.spawnDepth ?? "?"}   ${n(a.usage.output)} out   ${a.toolCalls} tools`);
      }
      console.log("");
    }
  }
}

/* ------------------------------------------------------------------ write */

/* Raw session dumps are data, not knowledge: they need no frontmatter and
 * belong to no note. The original reasoning — keep them out of the validated
 * tree — was right, but it was implemented as one machine's absolute path,
 * which shipped to every clone through the manifest and wrote to a drive that
 * exists nowhere else.
 *
 * Metrics/ is already outside Knowledge-OS and Project-OS, so a dump under it
 * is outside everything the schema governs, and .json is not walked as a note
 * regardless. The flag and the environment variable keep an existing baseline
 * reachable: pass --sessions, or set MEMOVALE_SESSIONS_DIR once. */
const SESSIONS_DIR =
  value("--sessions") || process.env.MEMOVALE_SESSIONS_DIR || join(VAULT, "Metrics", "sessions");

/* Same shape as validate-vault.mjs's own walk() but kept local: an 8-line
 * directory walk isn't worth a cross-tool import, and this one only needs
 * a count, not the file list itself. */
function countNotes(dir) {
  let count = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) count += countNotes(full);
    else if (entry.name.endsWith(".md")) count++;
  }
  return count;
}

const LOG_HEADER = `---
type: log
status: active
lifecycle: active
evidence: L2
---
# Context Metrics

Measured by \`Knowledge-OS/Tools/context-metrics.mjs --write\`. Each row is one session.

Repeat share and coverage cover governance and project knowledge only; work on the operating system itself is excluded.
Notes is the count of \`.md\` files under Project-OS/ at write time, not at session time.

Hit% is the share of context served from the prefix cache. Breaks counts requests whose reusable prefix got
shorter than the previous request's, and Reproc is what that cost in tokens processed a second time.
Rows written before 2026-09-14 predate these three columns and leave them empty rather than claim a measurement.

Shell is the count of distinct governance and project files read through Bash or PowerShell (\`cat\`, \`sed\`,
\`Get-Content\`…), parsed from the command line. It is a heuristic and is kept apart from Files and Re-read,
which come from file tools only. Rows written before 2026-10-13 predate it.

Writes is the count of distinct Project-OS notes the session wrote, by kind: T task or epic, F finding,
R research, A architecture, D decision, P product, U uncertainty ledger, C Current Context and its folder,
O any other note. It counts file-tool writes and writes parsed from shell command lines (\`>\`, \`sed -i\`,
\`Set-Content\`, a script's \`open(…, 'w')\`…). \`0\` means nothing was written; rows written before os-v9
(2026-10-26) predate the column and read \`—\`.

| Session | Ended | Requests | Output | Context peak | Mean | p95 | Notes | Files | Re-read | Coverage | Hit% | Breaks | Reproc | Label | Shell | Writes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
`;

/* The header line and its separator, taken from LOG_HEADER so the two can
 * never drift apart: the table's shape is declared once. */
const HEADER_ROW = LOG_HEADER.split("\n").find((l) => l.startsWith("| Session |"));
const HEADER_COLUMNS = HEADER_ROW.split("|").length - 2;

function cellsOf(row) {
  // `| a | b |` -> ["a", "b"]: the split yields an empty field at each end.
  return row.split("|").slice(1, -1);
}

/* Bring an existing log's header up to the one this script writes.
 *
 * LOG_HEADER is only written when the file is created, so a log started under
 * an older column set keeps that header forever while the rows below it grow
 * new columns. The rows are right and the header is wrong — every cell past
 * the last heading reads under nothing at all. This is the only path by which
 * a deployment that already has a log can be corrected: upgrade.mjs ships code,
 * not data.
 *
 * Narrow rows are padded with an em dash rather than a zero: they predate the
 * columns and must not claim a measurement that was never taken. Rows already
 * at or beyond the new width are left exactly as they are — once the header
 * names their columns, they are correct, and truncating them would destroy
 * measurements to satisfy a header that just grew. */
export function migrateHeader(text, headerRow = HEADER_ROW) {
  const want = headerRow.split("|").length - 2;
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith("| Session |"));
  // A file written on Windows carries `\r` at the end of each line; the header
  // constant does not. Comparing them raw would report a migration on every
  // run and rewrite the table to say the same thing.
  if (at === -1 || lines[at].trimEnd() === headerRow) return { text, migrated: false, padded: 0 };

  lines[at] = headerRow;
  lines[at + 1] = "|" + "---|".repeat(want);

  let padded = 0;
  for (let i = at + 2; i < lines.length; i++) {
    if (!lines[i].startsWith("|")) continue;
    const cells = cellsOf(lines[i]);
    if (cells.length >= want) continue;
    lines[i] = "| " + [...cells.map((c) => c.trim()), ...Array(want - cells.length).fill("—")].join(" | ") + " |";
    padded++;
  }
  return { text: lines.join("\n"), migrated: true, padded };
}

/* Place a session's row in the table, replacing the one already there.
 *
 * A session is closed more than once when work continues after a first
 * /mv-close, and the second close observes a superset of the first: the
 * transcript only grows. Skipping the write, as this did, left the table
 * holding the earlier numbers and counted the work after that close nowhere
 * at all. Replacement is therefore unconditional — there is no case where the
 * older row is the truer one. */
export function upsertRow(text, short, row) {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => l.startsWith(`| ${short} |`));
  if (at === -1) {
    const body = text.endsWith("\n") ? text : text + "\n";
    return { text: body + row + "\n", replaced: false };
  }
  lines[at] = row;
  return { text: lines.join("\n"), replaced: true };
}

function writeSnapshot(sessions) {
  const path = join(VAULT, LOG_NOTE);
  const dir = path.slice(0, path.lastIndexOf(sep));
  mkdirSync(dir, { recursive: true });
  if (!existsSync(path)) writeFileSync(path, LOG_HEADER, "utf8");

  let text = readFileSync(path, "utf8");
  const migration = migrateHeader(text);
  text = migration.text;

  let added = 0;
  let replaced = 0;
  const notes = countNotes(join(VAULT, "Project-OS"));
  const sessionsDir = SESSIONS_DIR;

  for (const s of sessions) {
    const short = s.sessionId.slice(0, 8);

    const gov = s.buckets.governance;
    const proj = s.buckets.project;
    const distinct = gov.distinctFiles + proj.distinctFiles;
    const reads = gov.reads + proj.reads;
    const repeats = gov.repeats + proj.repeats;
    const samples = [gov.coverage, proj.coverage].filter((c) => c !== null);
    const coverage = samples.length ? pct(samples.reduce((a, b) => a + b, 0) / samples.length) : "—";
    const ended = (s.last ?? "").slice(0, 16).replace("T", " ");
    const out = s.usage.output + s.subagentUsage.output;

    const hit = s.cache ? pct(s.cache.hitRate) : "—";
    const breaks = s.cache ? n(s.cache.prefixBreaks) : "—";
    const reproc = s.cache ? n(s.cache.tokensReprocessed) : "—";
    const shell = gov.shellFilesRead + proj.shellFilesRead;

    const row = `| ${short} | ${ended} | ${s.requests} | ${n(out)} | ${n(s.context.peak)} | ${n(s.context.mean)} | ${n(s.context.p95)} | ${notes} | ${distinct} | ${reads ? Math.round((repeats / reads) * 100) + "%" : "—"} | ${coverage} | ${hit} | ${breaks} | ${reproc} | ${LABEL ?? "—"} | ${shell} | ${writesCell(s.writesByKind)} |`;

    const result = upsertRow(text, short, row);
    text = result.text;
    if (result.replaced) replaced++;
    else added++;

    // Full detail per session, for backfilling anything the row can't hold.
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, `${s.sessionId}.json`), JSON.stringify(s, null, 2), "utf8");
  }

  writeFileSync(path, text, "utf8");

  if (migration.migrated) {
    console.log(
      `Migrated the header of ${LOG_NOTE} to ${HEADER_COLUMNS} columns` +
        (migration.padded ? `, padding ${migration.padded} earlier row(s)` : "")
    );
  }
  const what = [added ? `wrote ${added}` : null, replaced ? `replaced ${replaced}` : null].filter(Boolean).join(", ");
  console.log(what ? `${what} row(s) in ${LOG_NOTE}` : `No sessions to record in ${LOG_NOTE}`);
}

/* ------------------------------------------------------------------- main */

function main() {
  let sessions = findSessions();

  if (ONE_SESSION) {
    sessions = sessions.filter((s) => s.sessionId.startsWith(ONE_SESSION));
  }

  if (!sessions.length) {
    console.error(`No transcripts found under ${TRANSCRIPTS}`);
    process.exit(1);
  }

  let analysed = sessions.map(analyseSession).filter((s) => s.touchedVault || ONE_SESSION);

  if (!analysed.length) {
    console.error(`No session touched ${VAULT}`);
    process.exit(1);
  }

  analysed.sort((a, b) => String(b.last).localeCompare(String(a.last)));
  if (!ALL && !ONE_SESSION) analysed = analysed.slice(0, 1);

  if (JSON_OUT) {
    console.log(JSON.stringify({ vault: VAULT, sessions: analysed }, null, 2));
  } else {
    report(analysed);
  }

  if (WRITE) writeSnapshot(analysed);
}

/* Run only when invoked directly, so the test can import `analyseCache` without
 * scanning every transcript on the machine and exiting the process. The same
 * guard context-provider.mjs uses. */
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
