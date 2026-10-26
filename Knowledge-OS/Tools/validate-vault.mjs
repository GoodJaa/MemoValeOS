#!/usr/bin/env node
/*
 * validate-vault.mjs
 *
 * Deterministic implementation of Knowledge-OS/Protocols/Knowledge Maintenance Protocol.
 * Checks the vault against its own schema instead of reading every note by hand.
 *
 * Usage — the vault root is found from this file's own location, not from the
 * working directory, so this runs correctly from anywhere:
 *   node "Knowledge-OS/Tools/validate-vault.mjs"
 *   node "Knowledge-OS/Tools/validate-vault.mjs" --json
 *
 * Exit code is 1 when any error is found, 0 otherwise. Warnings never fail the run.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, sep, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
/* js-yaml is vendored (Tools/vendor/, 4.3.2, MIT) rather than installed: a
 * host whose npm is old or offline could not run `npm install`, and the
 * validator is the first thing an installation runs. */
import { load as loadYaml, YAMLException } from "./vendor/js-yaml.mjs";

/* The vault root is where this file structurally lives — two levels up from
 * Knowledge-OS/Tools/ — not process.cwd(). A vault is sometimes a subfolder of
 * a larger project (real code as a sibling of Knowledge-OS/Project-OS); if the
 * caller's cwd is that project's root instead of the vault, cwd-based scanning
 * walks the whole project — dependencies included — rather than the vault. */
const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const JSON_OUT = process.argv.includes("--json");

/* The install record, `.mvos/install.json`, written by adopt.mjs on every
 * apply: the project root the OS was installed into, and the mode. When it
 * exists, the project root is taken from it rather than guessed — the guesses
 * below were wrong in exactly the layout the personal install recommends (a
 * vault with its own .git inside the project): `.claude/` was looked for in
 * the vault, and `source` commits were asked of the vault's repository, which
 * never held the project's code. */
function readInstallRecord() {
  try {
    const r = JSON.parse(readFileSync(join(VAULT, ".mvos", "install.json"), "utf8"));
    return r && typeof r === "object" && typeof r.projectRoot === "string" ? r : null;
  } catch {
    return null;
  }
}
const INSTALL = readInstallRecord();
const PROJECT_ROOT = INSTALL ? resolve(VAULT, INSTALL.projectRoot) : null;
/* A personal install brings its commands and hook as the plugin `mv`; there
 * is no deployed copy in `.claude/` to compare against Dist. */
const PLUGIN_INSTALL = INSTALL?.mode === "local";

/* Without a record, .claude/commands/ can sit beside Knowledge-OS/Project-OS
 * inside the vault (a standalone MemoValeOS clone, vault root == repo root) or
 * one level above VAULT (MemoValeOS embedded as a subfolder of a larger
 * project, as in this repo). Prefer whichever actually exists; if neither
 * does, there is nothing to check — not every deployment has slash commands
 * at all. */
function findClaudeDir() {
  if (PROJECT_ROOT) return existsSync(join(PROJECT_ROOT, ".claude")) ? join(PROJECT_ROOT, ".claude") : null;
  for (const candidate of [join(VAULT, ".claude"), join(VAULT, "..", ".claude")]) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

// Folders that hold knowledge and are subject to the schema.
const KNOWLEDGE_ROOTS = ["Knowledge-OS", "Project-OS"];

/* Archive is retained history and is non-authoritative by Brain Rules.
 * Inbox holds a host project's own CLAUDE.md, moved here verbatim by
 * adopt.mjs: its links point into whatever that project documents, not into
 * this vault, and judging them against this note graph would report a foreign
 * file's working links as broken. */
const LINK_EXEMPT = ["Archive", "Inbox"];

/* Markdown links (`[text](path)`) are checked in the same files, with Plans/
 * exempt as well. A plan is a working document written in an editor, and its
 * links are an editor's: `[Backlog.md](MemoValeOS/Backlog.md)` resolves from
 * the repository root in the IDE that wrote it and from nowhere in the vault.
 * Rewriting dated plans to satisfy a rule added after them would change the
 * record without making anything more true. */
const MD_LINK_EXEMPT = [...LINK_EXEMPT, "Plans"];

/* Entity templates are scaffolds, not notes: their fields hold placeholders
 * rather than values by definition, so the note schema (required fields,
 * evidence floors, scaffold-body check) does not apply to them at all — every
 * point where that schema happened not to fire on a template so far was
 * accidental (no rule here validates date-shaped fields, so `{{date}}` was
 * never actually checked) rather than a deliberate exemption. Templates get
 * their own narrower check instead: see checkTemplate. */
const TEMPLATES_PATH = join("Project-OS", "Templates");

/* Dist/ is the OS layer's own distributable: slash commands, the budget hook,
 * a settings fragment and the CLAUDE.md redirect body. Those .md files carry
 * Claude Code's command frontmatter (`description`, `allowed-tools`), which is
 * a different schema entirely — governing them as notes produces five errors
 * per command and states nothing true. They are still covered by
 * os-layer-outside-manifest, and by deployed-command-drift against the copy
 * actually deployed into the project root.
 *
 * Inbox/ holds a host project's pre-existing CLAUDE.md, moved verbatim by
 * adopt.mjs. Forcing frontmatter onto an adopted file would mean editing it,
 * and the whole point of the move is that it arrives unaltered for a human to
 * distribute. */
const DIST_PATH = join("Knowledge-OS", "Dist");
const INBOX_PATH = join("Project-OS", "Inbox");

function isDistributable(relPath) {
  return relPath === DIST_PATH || relPath.startsWith(DIST_PATH + sep);
}

function isInbox(relPath) {
  return relPath === INBOX_PATH || relPath.startsWith(INBOX_PATH + sep);
}

/* Only these two are ever substituted — by Obsidian's core `templates` plugin
 * on manual insertion. Anything else (`{{what}}`, `{{where}}`, …) reaches a
 * real note verbatim unless a slash command fills it in first, which is
 * exactly the class of bug that shipped in the old Finding.md. */
const CORE_TEMPLATE_PLACEHOLDERS = ["title", "date"];

/* Belt-and-suspenders: a vault can also legitimately be a project's own root
 * (this system's own distribution repo is exactly that). If real code ever
 * sits directly under the vault rather than beside it, these never hold
 * knowledge and their own markdown is not this vault's to check — a `[[1]]`
 * footnote in a dependency's README is not a broken wikilink.
 * __fixtures__ holds validate-vault.test.mjs's deliberately-broken fixture
 * vaults; each one is invalid by design, so scanning them here would report
 * this repository's own test data as violations of itself. */
const NEVER_WALK = [
  "node_modules",
  "dist",
  "build",
  ".next",
  "coverage",
  ".git",
  "__fixtures__",
  "__provider_fixtures__",
];

/* The schema vocabulary lives in one place — Schema/schema.json — so it cannot
 * drift between this validator, the schema docs, and (previously) the
 * generator's embedded copy. The .md files under Schema/ describe what each
 * value means; this file is the source of the values themselves. */
const schema = loadSchema(join(dirname(fileURLToPath(import.meta.url)), "..", "Schema", "schema.json"));

/* The vocabulary is read, not trusted. A missing key used to surface as a
 * TypeError deep inside a check, and a misspelled type name inside
 * `statusByType` silently switched off status checking for the type it meant —
 * the one failure a validator must never have, a rule that stops existing
 * without saying so. Both now stop the run with the reason. */
function loadSchema(path) {
  let data;
  try {
    data = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    schemaFail(`cannot read ${path}: ${e.message}`);
  }
  const arrays = ["metadataKeys", "coreTypes", "operationalTypes", "metaTypes", "lifecycles", "priorities", "relationshipTypes", "evidenceLevels"];
  const maps = ["statusByType", "evidenceFloorByType", "activeLifecycleStatuses"];
  for (const key of arrays) {
    if (!Array.isArray(data[key]) || data[key].some((v) => typeof v !== "string")) schemaFail(`\`${key}\` must be an array of strings`);
  }
  for (const key of maps) {
    if (!data[key] || typeof data[key] !== "object" || Array.isArray(data[key])) schemaFail(`\`${key}\` must be an object`);
  }
  const types = [...data.coreTypes, ...data.operationalTypes, ...data.metaTypes];
  for (const key of ["statusByType", "evidenceFloorByType", "evidenceAlternativeByType", "activeLifecycleStatuses"]) {
    for (const type of Object.keys(data[key] ?? {})) {
      if (!types.includes(type)) schemaFail(`\`${key}\` names \`${type}\`, which is not a type`);
    }
  }
  for (const [type, statuses] of Object.entries(data.statusByType)) {
    if (!Array.isArray(statuses) || statuses.length === 0) schemaFail(`\`statusByType.${type}\` must be a non-empty array`);
  }
  /* A settled status the type does not have would make the rule silently
   * unreachable — the same failure as a misspelled type above. */
  for (const [type, statuses] of Object.entries(data.activeLifecycleStatuses)) {
    if (!Array.isArray(statuses) || statuses.length === 0) schemaFail(`\`activeLifecycleStatuses.${type}\` must be a non-empty array`);
    for (const status of statuses) {
      if (!(data.statusByType[type] ?? []).includes(status)) {
        schemaFail(`\`activeLifecycleStatuses.${type}\` names \`${status}\`, which is not a status of \`${type}\``);
      }
    }
  }
  for (const [type, floor] of Object.entries(data.evidenceFloorByType)) {
    if (!data.evidenceLevels.includes(floor)) schemaFail(`\`evidenceFloorByType.${type}\` is \`${floor}\`, not an evidence level`);
  }
  /* An origin names the types it applies to and the fields it requires; a
   * misspelling in either would switch the origin's requirement off without a
   * word, so both are checked against what the schema defines. */
  if (data.origins !== undefined && (!data.origins || typeof data.origins !== "object" || Array.isArray(data.origins))) {
    schemaFail("`origins` must be an object");
  }
  for (const [origin, spec] of Object.entries(data.origins ?? {})) {
    for (const key of ["types", "evidenceAlternatives", "requiredFields", "requiredFieldsWhenActive"]) {
      if (!Array.isArray(spec?.[key]) || spec[key].some((v) => typeof v !== "string")) schemaFail(`\`origins.${origin}.${key}\` must be an array of strings`);
    }
    for (const type of spec.types) if (!types.includes(type)) schemaFail(`\`origins.${origin}.types\` names \`${type}\`, which is not a type`);
    for (const field of [...spec.requiredFields, ...spec.requiredFieldsWhenActive]) {
      if (!data.metadataKeys.includes(field)) schemaFail(`\`origins.${origin}\` requires \`${field}\`, which is not a metadata key`);
    }
  }
  return data;
}

function schemaFail(message) {
  console.error(`Knowledge-OS/Schema/schema.json is invalid: ${message}`);
  process.exit(2);
}

const CORE_TYPES = schema.coreTypes;
const OPERATIONAL_TYPES = schema.operationalTypes;
const META_TYPES = schema.metaTypes;
const ALL_TYPES = [...CORE_TYPES, ...OPERATIONAL_TYPES, ...META_TYPES];

/* Types are compared case-insensitively everywhere: the frontmatter checks
 * always lowercased, but the Epic, Task and orphan passes compared the raw
 * value, so `type: Task` was a valid type that no closing rule ever saw. */
const typeOf = (fm) => String(fm?.type ?? "").trim().toLowerCase();

// Meta types other than `index` belong to Knowledge-OS only.
const KNOWLEDGE_OS_ONLY = META_TYPES.filter((t) => t !== "index");

/* The mirror of KNOWLEDGE_OS_ONLY: core and operational types describe the
 * project, not the reusable system, so (Knowledge Types: "Do not use a core
 * or operational type for a Knowledge-OS document") they belong outside
 * Knowledge-OS. `index` is exempt in both directions — Knowledge Types
 * explicitly allows it in Project-OS for pure navigation notes, so by the
 * same logic a navigation note staying `index` does not become disallowed
 * merely for living in Knowledge-OS. */
const PROJECT_TYPES_OUTSIDE_KNOWLEDGE_OS = [...CORE_TYPES, ...OPERATIONAL_TYPES];

const LIFECYCLES = schema.lifecycles;

/* A type absent from statusByType carries no `status` at all. Product and
 * Architecture had `draft, active, superseded` — the lifecycle vocabulary
 * again — and six Architecture notes said `active` in one field and `draft` in
 * the other. Two fields encoding one fact will disagree; for these types
 * `lifecycle` is the only one. loadSchema() rejects an entry for an unknown type. */
const STATUS_BY_TYPE = schema.statusByType;
const statusRequired = (type) => !ALL_TYPES.includes(type) || Boolean(STATUS_BY_TYPE[type]);
const statusForbidden = (type) => ALL_TYPES.includes(type) && !STATUS_BY_TYPE[type];

/* Statuses that settle a note: once a Task is `done`, a Decision `accepted`,
 * an Epic under way or finished, its knowledge is relied on, and `lifecycle:
 * draft` says the opposite. Kept in schema.json so the rule is one rule,
 * extended by a line of data rather than by another copy of the loop. */
const ACTIVE_LIFECYCLE_STATUSES = schema.activeLifecycleStatuses;

const METADATA_KEYS = schema.metadataKeys;
const PRIORITIES = schema.priorities;
const RELATIONSHIP_TYPES = schema.relationshipTypes;
const EVIDENCE_LEVELS = schema.evidenceLevels;
const EVIDENCE_FLOOR = schema.evidenceFloorByType;

/* Evidence Schema states the Product rule as "`user-provided` or `L4`", but
 * `user-provided` is not a rung on the L1→L4 ladder — it answers a different
 * question. L1 through L4 grade how directly a claim was observed in the
 * running system; `user-provided` says the claim is the owner's to make, and
 * no amount of reading code can establish or refute it. Ranking it against
 * the levels is a category error, so it cannot live in `evidenceLevels` and
 * be compared by index.
 *
 * Until this existed only the L4 half was enforceable, which had a concrete
 * cost: eight Product notes stating the owner's own intent sat in `draft`
 * with no way out except a ceremonial round of confirmations — eight "yes"es
 * that would have graded nothing. Treated as a satisfying alternative to the
 * floor rather than as a level, it records what is actually true of them. */
const EVIDENCE_ALTERNATIVES = schema.evidenceAlternativeByType ?? {};

/* Where a note's knowledge came from, when that changes what it needs. The
 * one origin so far is `inherited`: a rule the host team already followed
 * before the OS arrived, filed as a Decision. Its authority is the team's
 * adoption of it, not an observation of the running system, so it may stand
 * on `user-provided` — the owner's ratification — in place of L2. In return
 * it must name the host file and commit it was read from (`source`, which
 * `stale-source` then watches) and, once relied on, the date it was ratified.
 * The first real installation distributed its host's CLAUDE.md into
 * Decisions by hand, and all seventeen of its Decisions stayed `proposed`:
 * nothing about a team's rule can reach L2 (owner's decision, 2026-10-25).
 * The project's own Decisions keep the L2 floor. The second origin,
 * `imported`, marks a Task or Epic brought in from a tracker by
 * task-import.mjs; it grants nothing and requires the tracker's `key`. */
const ORIGINS = schema.origins ?? {};
const ALL_EVIDENCE_VALUES = [
  ...EVIDENCE_LEVELS,
  ...Object.values(EVIDENCE_ALTERNATIVES).flat(),
  ...Object.values(ORIGINS).flatMap((o) => o.evidenceAlternatives),
];

const errors = [];
const warnings = [];

const err = (file, rule, message) => errors.push({ file, rule, message });
const warn = (file, rule, message) => warnings.push({ file, rule, message });

/* An optional `.mvignore` at the vault root, for the tree this validator was
 * not designed against: a project that keeps its own markdown somewhere the
 * ownership rules still reach, or a generated directory nobody thought to name
 * in NEVER_WALK. One gitignore-style prefix glob per line, `#` for comments.
 *
 * Two guard rails, because a suppression mechanism with no limits eventually
 * suppresses the thing it was protecting:
 *
 *   - A line that would exclude the OS layer is itself an error. Ignoring
 *     `Knowledge-OS/Rules/**` would let os-layer-outside-manifest be defeated
 *     by one line in a file nobody reviews.
 *   - A line matching nothing is a warning. A stale ignore outliving its
 *     reason is how these files stop describing reality.
 *
 * The count of excluded paths is printed with the scan summary: a suppression
 * that leaves no trace in the output is a suppression nobody audits. */
const MVIGNORE_PATH = join(VAULT, ".mvignore");
const PROTECTED_FROM_IGNORE = [
  join("Knowledge-OS", "Rules"),
  join("Knowledge-OS", "Schema"),
  join("Knowledge-OS", "Protocols"),
  join("Knowledge-OS", "Tools"),
];

const mvignoreLines = existsSync(MVIGNORE_PATH)
  ? readFileSync(MVIGNORE_PATH, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"))
  : [];

const mvignoreUsed = new Set();

function mvignoreMatches(relPosix) {
  for (const line of mvignoreLines) {
    const bare = line.replace(/\/$/, "");
    if (relPosix === bare || relPosix.startsWith(bare + "/") || manifestToRegExp(line).test(relPosix)) {
      mvignoreUsed.add(line);
      return true;
    }
  }
  return false;
}

let mvignoreExcluded = 0;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    if (entry.isDirectory() && NEVER_WALK.includes(entry.name)) continue;
    const full = join(dir, entry.name);
    if (mvignoreLines.length) {
      const rel = relative(VAULT, full).split(sep).join("/");
      if (mvignoreMatches(rel)) {
        mvignoreExcluded++;
        continue;
      }
    }
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function inAnyFolder(relPath, folders) {
  const segments = relPath.split(sep).slice(0, -1);
  return segments.some((s) => folders.includes(s));
}

function isTemplate(relPath) {
  return relPath.startsWith(TEMPLATES_PATH + sep) || relPath === TEMPLATES_PATH;
}

/* Which files this vault is entitled to judge at all.
 *
 * walk() collects every .md under VAULT, and when the vault is a subfolder of
 * a larger project that is the right scope for *finding* things — but not for
 * *judging* them. A host project's own markdown (a memory bank, ADRs, docs/)
 * carries wikilinks into its own graph, which this vault has never been shown.
 * Resolving those against this vault's notes reports a foreign file's working
 * links as broken: twenty-five errors on first install, none of them true, and
 * a red gate on day one is how a validator teaches its reader to stop looking.
 *
 * The vault's own territory is the two knowledge roots, the three directories
 * that hold its working records, its developer documentation (Docs/), and the
 * loose files at its root. Everything else in the tree is somebody else's and
 * is walked, not checked.
 *
 * Docs/ is owned but not governed, the same standing as README.md and QA.md:
 * written for people, so no frontmatter is demanded, but its links are checked
 * and other notes may link into it. Without this a page that names a renamed
 * tool keeps pointing at it silently, and documentation that drifts unnoticed
 * is worse than none. */
const VAULT_OWNED_ROOTS = [...KNOWLEDGE_ROOTS, "Metrics", "Plans", "Archive", "Docs"];

function isVaultOwned(relPath) {
  const segments = relPath.split(sep);
  if (segments.length === 1) return true; // README.md, QA.md, CHANGELOG.md …
  return VAULT_OWNED_ROOTS.includes(segments[0]);
}

function isGoverned(relPath) {
  return (
    KNOWLEDGE_ROOTS.includes(relPath.split(sep)[0]) &&
    !isTemplate(relPath) &&
    !isDistributable(relPath) &&
    !isInbox(relPath)
  );
}

/* YAML auto-types an unquoted date-shaped scalar (`created: 2026-09-04`) as a
 * JS Date, not a string — every field this schema defines (`created`,
 * `updated`, `stale`-adjacent dates) is meant to be compared and displayed as
 * `YYYY-MM-DD`. Converting back to that form here means the rest of this file,
 * and anything downstream that reads this validator's frontmatter, keeps
 * working with plain strings without needing to know YAML did this. */
function normalizeDates(fm) {
  for (const key of Object.keys(fm)) {
    if (fm[key] instanceof Date) fm[key] = fm[key].toISOString().slice(0, 10);
  }
  return fm;
}

/* YAML frontmatter reader, via js-yaml. Returns null fm when the note has no
 * frontmatter block, and a string fmError (instead of throwing) when the block
 * exists but does not parse as YAML — a malformed note should surface as one
 * validator finding on that file, not crash the whole run. A frontmatter block
 * that parses to a non-object (a bare scalar or a list) is also reported as an
 * error: Metadata Schema is a mapping of keys to values, so anything else is
 * not a valid frontmatter document even though it is valid YAML. */
function parseFrontmatter(text) {
  if (!text.startsWith("---")) return { fm: null, body: text, fmError: null, raw: null };
  const end = text.indexOf("\n---", 3);
  if (end === -1) return { fm: null, body: text, fmError: null, raw: null };
  const raw = text.slice(3, end);
  const body = text.slice(end + 4);
  try {
    const parsed = loadYaml(raw);
    if (parsed === null || parsed === undefined) return { fm: {}, body, fmError: null, raw };
    if (typeof parsed !== "object" || Array.isArray(parsed)) {
      return { fm: null, body, fmError: "frontmatter must be a YAML mapping of keys to values", raw };
    }
    return { fm: normalizeDates(parsed), body, fmError: null, raw };
  } catch (e) {
    const message = e instanceof YAMLException ? e.message : String(e);
    return { fm: null, body, fmError: message, raw };
  }
}

/* Templates are scaffolds: their fields hold either a real value or a
 * `{{placeholder}}` — and `{{word}}` is not valid YAML in value position (it
 * parses as a flow mapping whose key is itself an empty flow mapping, e.g.
 * `{{date}}` silently becomes `{"[object Object]": null}`), so this reads the
 * frontmatter block as text, one `key: value` line at a time, rather than
 * through the YAML parser used for real notes. A value is accepted only if it
 * is a placeholder Obsidian's core `templates` plugin actually substitutes
 * (`{{title}}`, `{{date}}`) or a literal value valid for that key — anything
 * else, including a placeholder nothing fills in, is reported so it cannot
 * reach a real note unsubstituted the way `{{what}}` once did. */
function checkTemplate(rel, raw) {
  if (raw === null) {
    err(rel, "missing-frontmatter", "template has no frontmatter block");
    return;
  }
  const seenKeys = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    seenKeys.push(key);

    if (!METADATA_KEYS.includes(key)) {
      err(rel, "unknown-metadata-key", `frontmatter key \`${key}\` is not defined by Metadata Schema`);
      continue;
    }

    const placeholder = value.match(/^\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}$/);
    if (placeholder) {
      if (!CORE_TEMPLATE_PLACEHOLDERS.includes(placeholder[1])) {
        err(
          rel,
          "unfilled-template-placeholder",
          `\`${key}: ${value}\` — \`{{${placeholder[1]}}}\` is not substituted by Obsidian's core templates plugin (only ${CORE_TEMPLATE_PLACEHOLDERS.map((p) => `{{${p}}}`).join(", ")} are) and nothing else fills it in here; it would reach a real note verbatim`
        );
      }
      continue;
    }

    if (key === "type" && !ALL_TYPES.includes(value.toLowerCase())) {
      err(rel, "unknown-type", `type \`${value}\` is not defined by Knowledge Types`);
    }
    if (key === "lifecycle" && !LIFECYCLES.includes(value)) {
      err(rel, "unknown-lifecycle", `lifecycle \`${value}\` is not defined by Knowledge Lifecycle`);
    }
    if (key === "evidence" && !ALL_EVIDENCE_VALUES.includes(value)) {
      err(rel, "unknown-evidence-level", `evidence \`${value}\` is not defined by Evidence Schema`);
    }
    if (key === "priority" && !PRIORITIES.includes(value)) {
      err(rel, "unknown-priority", `priority \`${value}\` is not defined by Metadata Schema`);
    }
    if (key === "status") {
      const type = templateType(raw);
      const allowed = type && STATUS_BY_TYPE[type];
      if (allowed && !allowed.includes(value)) {
        err(rel, "invalid-status", `status \`${value}\` is not allowed for type \`${type}\` (expected: ${allowed.join(", ")})`);
      }
      if (type && statusForbidden(type)) {
        err(rel, "status-not-allowed-for-type", `type \`${type}\` has no status; \`lifecycle\` alone says whether it is current`);
      }
    }
  }
  const type = templateType(raw);
  for (const field of ["type", "status", "lifecycle"]) {
    if (field === "status" && type && !statusRequired(type)) continue;
    if (!seenKeys.includes(field)) err(rel, "missing-required-field", `required field \`${field}\` is absent`);
  }
}

function templateType(raw) {
  const typeLine = raw.split("\n").find((l) => l.trim().startsWith("type:"));
  return typeLine ? typeLine.split(":")[1].trim().toLowerCase() : null;
}

/* A note is a scaffold when nothing survives removing frontmatter, headings,
 * blockquote hints, list bullets with no text, and horizontal rules. */
function isScaffold(body) {
  const meaningful = body
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .filter((l) => !l.startsWith("#"))
    .filter((l) => !l.startsWith(">"))
    .filter((l) => !/^[-*_]{3,}$/.test(l))
    .filter((l) => !/^[-*+]\s*$/.test(l))
    .filter((l) => l !== "-");
  return meaningful.length === 0;
}

function stripCodeAndInline(text) {
  return text.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
}

function collectLinks(text) {
  const links = [];
  const re = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(text)) !== null) links.push(m[1].trim());
  return links;
}

/* Markdown links and images, `[text](dest)` and `![alt](dest)`, with an
 * optional `"title"` and the `<…>` form for destinations with spaces. Only the
 * destination is returned. Wikilinks never match: `[[x]]` is not followed by
 * `(`. Callers strip code first, as for wikilinks — a link shown as an example
 * is not a link. */
function collectMarkdownLinks(text) {
  const out = [];
  const re = /!?\[[^\]\n]*\]\(\s*(<[^>\n]*>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g;
  let m;
  while ((m = re.exec(text)) !== null) out.push(m[1]);
  return out;
}

/* Where a Markdown link destination points, as an absolute path — or
 * `undefined` when it does not name a file at all: a URL with a scheme
 * (`https:`, `mailto:`, `obsidian:`), or an anchor into the same page. A
 * destination is relative to the file that holds it, as Markdown defines it;
 * one starting with `/` is taken from the vault root, which is what Obsidian
 * means by it. Percent-encoding is undone, so `Other%20Page.md` finds the
 * file a reader would open. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
function markdownLinkTarget(rel, dest) {
  let d = dest.startsWith("<") ? dest.slice(1, -1) : dest;
  if (URL_SCHEME.test(d)) return undefined;
  d = d.split("#")[0].split("?")[0];
  if (!d) return undefined;
  try {
    d = decodeURI(d);
  } catch {
    /* a stray `%` is part of the name, not an escape */
  }
  return d.startsWith("/") ? resolve(VAULT, "." + d) : resolve(VAULT, dirname(rel), d);
}

/* Inline relationship fields, per Schema/Relationship Types: a line that begins
 * `name:: `. A misspelled name is the quiet failure this catches — the link
 * still resolves, the note still renders, and the graph still draws the edge,
 * so nothing looks wrong. Only the relationship stops existing: no query that
 * asks by type will ever return it again. Matched at line start only, which is
 * the form the schema prescribes. */
function collectInlineFields(text) {
  const names = [];
  const re = /^[ 	]*(?:[-*+][ 	]+)?([A-Za-z][A-Za-z0-9_-]*)::/gm;
  let m;
  while ((m = re.exec(text)) !== null) names.push(m[1]);
  return names;
}

// ---------------------------------------------------------------- collect

const allFiles = walk(VAULT).map((f) => relative(VAULT, f));
const notePaths = allFiles.filter((f) => f.endsWith(".md"));

/* Link resolution mirrors Obsidian: full path, or unique basename. A bare
 * `[[Target]]` link never resolves to a non-note file by basename — only a
 * full-path link can address an asset — so only notePaths feed this map.
 * Including every file (assets, config, anything without a `.md` suffix)
 * previously made an unrelated file of the same stem — e.g. a stray
 * `README` with no extension — collide with a real note and produce a
 * false `ambiguous-basename-link` on a bare link that was never actually
 * ambiguous. */
/* Built from the vault's own notes only. A foreign tree that happens to hold
 * an `Architecture.md` would otherwise collide with this vault's note of the
 * same name and make a legitimate bare `[[Architecture]]` link ambiguous —
 * an error raised inside the vault, caused entirely by a file outside it. */
const ownedNotePaths = notePaths.filter(isVaultOwned);

const byBasename = new Map();
for (const p of ownedNotePaths) {
  const base = p.split(sep).pop().replace(/\.md$/, "");
  if (!byBasename.has(base)) byBasename.set(base, []);
  byBasename.get(base).push(p);
}
/* Same ownership scope as byBasename: a full-path link that lands on a file
 * outside the vault's own territory has not resolved to anything this vault
 * knows, and counting it as resolved would let a foreign tree silently satisfy
 * a link the vault cannot actually follow. */
const pathSet = new Set(allFiles.filter(isVaultOwned).map((p) => p.split(sep).join("/")));

/* A link with a path segment resolves the way Obsidian resolves it: to the
 * file whose path is exactly that, or else ends with it (`[[Schema/X]]` from
 * inside Knowledge-OS reaches `Knowledge-OS/Schema/X.md`). It used to fall
 * back to the basename alone, so `[[Wrong/Folder/Note]]` passed as long as
 * some `Note.md` existed anywhere — a link to a folder that does not exist,
 * reported as fine. */
const ownedFilePaths = [...pathSet];

function pathLinkCandidates(norm, paths) {
  const exact = paths.filter((p) => p === norm || p === norm + ".md");
  if (exact.length) return exact;
  return paths.filter((p) => p.endsWith("/" + norm + ".md") || p.endsWith("/" + norm));
}

function linkResolves(target) {
  const norm = target.split("\\").join("/").replace(/\.md$/, "");
  if (norm.includes("/")) return pathLinkCandidates(norm, ownedFilePaths).length > 0;
  if (pathSet.has(norm + ".md") || pathSet.has(norm)) return true;
  return byBasename.has(norm);
}

/* A bare link (no path segment) that matches more than one file is not an
 * error — Obsidian still opens something — but which file it opens is
 * whichever the app's own tie-break picks, not whatever the author intended.
 * The same failure once hit two files both named "Context Index". Full-path
 * links are exempt: they name their target unambiguously regardless of how
 * many other files share its basename. */
function ambiguousBareLink(target) {
  const norm = target.split("\\").join("/").replace(/\.md$/, "");
  if (norm.includes("/")) {
    // A partial path can still match two files; an exact one cannot.
    const matches = pathLinkCandidates(norm, ownedFilePaths);
    return matches.length > 1 ? matches : null;
  }
  const matches = byBasename.get(norm);
  return matches && matches.length > 1 ? matches : null;
}

/* Resolve a wikilink target to the note(s) it actually addresses, the same
 * way Obsidian would: a target containing a path segment names one file
 * exactly; a bare basename may be ambiguous, and must resolve to every note
 * sharing that basename, not just the first one found by iteration order. */
function resolveLinkTargets(target) {
  const norm = target.split("\\").join("/").replace(/\.md$/, "");
  if (norm.includes("/")) {
    const posixNotes = ownedNotePaths.map((p) => p.split(sep).join("/"));
    const hits = new Set(pathLinkCandidates(norm, posixNotes));
    return ownedNotePaths.filter((p) => hits.has(p.split(sep).join("/")));
  }
  return byBasename.get(norm) || [];
}

const notes = new Map();

for (const rel of notePaths) {
  const text = readFileSync(join(VAULT, rel), "utf8");
  const { fm, body, fmError, raw } = parseFrontmatter(text);
  notes.set(rel, { fm, body, fmError, raw, text });
}

// ---------------------------------------------------------------- checks

for (const [rel, note] of notes) {
  const governed = isGoverned(rel);
  const { fm, body, fmError, raw } = note;

  if (isTemplate(rel)) {
    checkTemplate(rel, raw);
  } else if (governed) {
    if (fmError) {
      err(rel, "invalid-yaml-frontmatter", `frontmatter is not valid YAML: ${fmError}`);
    } else if (!fm) {
      err(rel, "missing-frontmatter", "note has no frontmatter block");
    } else {
      const type = (fm.type || "").toLowerCase();
      const present = (field) => !(fm[field] === undefined || fm[field] === null || String(fm[field]).trim() === "");

      for (const field of ["type", "status", "lifecycle"]) {
        if (field === "status" && fm.type && !statusRequired(type)) continue;
        if (!present(field)) err(rel, "missing-required-field", `required field \`${field}\` is absent`);
      }
      if (present("status") && statusForbidden(type)) {
        err(rel, "status-not-allowed-for-type", `type \`${type}\` has no status; \`lifecycle\` alone says whether it is current`);
      }

      for (const key of Object.keys(fm)) {
        if (!METADATA_KEYS.includes(key)) {
          err(rel, "unknown-metadata-key", `frontmatter key \`${key}\` is not defined by Metadata Schema`);
        }
      }

      if (fm.type && !ALL_TYPES.includes(type)) {
        err(rel, "unknown-type", `type \`${fm.type}\` is not defined by Knowledge Types`);
      }
      if (KNOWLEDGE_OS_ONLY.includes(type) && !rel.startsWith("Knowledge-OS")) {
        err(rel, "meta-type-outside-knowledge-os", `meta type \`${type}\` is only allowed inside Knowledge-OS`);
      }
      if (PROJECT_TYPES_OUTSIDE_KNOWLEDGE_OS.includes(type) && rel.startsWith("Knowledge-OS")) {
        err(rel, "project-type-inside-knowledge-os", `core/operational type \`${type}\` is not allowed inside Knowledge-OS`);
      }

      if (fm.lifecycle && !LIFECYCLES.includes(fm.lifecycle)) {
        err(rel, "unknown-lifecycle", `lifecycle \`${fm.lifecycle}\` is not defined by Knowledge Lifecycle`);
      }

      const allowed = STATUS_BY_TYPE[type];
      if (fm.status && allowed && !allowed.includes(fm.status)) {
        err(rel, "invalid-status", `status \`${fm.status}\` is not allowed for type \`${type}\` (expected: ${allowed.join(", ")})`);
      }

      /* An origin applies only where the schema defines it for the type; an
       * unknown one, or one on the wrong type, grants nothing and is said so. */
      let origin = null;
      if (present("origin")) {
        const spec = ORIGINS[fm.origin];
        if (!spec) {
          err(rel, "invalid-metadata-value", `\`origin\` is \`${fm.origin}\`, expected one of: ${Object.keys(ORIGINS).join(", ") || "(none defined)"}`);
        } else if (!spec.types.includes(type)) {
          err(rel, "invalid-metadata-value", `\`origin: ${fm.origin}\` is defined for ${spec.types.join(", ")}, not for \`${type}\``);
        } else {
          origin = spec;
        }
      }
      const alternatives = [...(EVIDENCE_ALTERNATIVES[type] ?? []), ...(origin?.evidenceAlternatives ?? [])];

      if (fm.evidence && !ALL_EVIDENCE_VALUES.includes(fm.evidence)) {
        err(rel, "unknown-evidence-level", `evidence \`${fm.evidence}\` is not defined by Evidence Schema`);
      } else if (fm.evidence && !EVIDENCE_LEVELS.includes(fm.evidence) && !alternatives.includes(fm.evidence)) {
        /* An alternative such as `user-provided` is not a level; Evidence
         * Schema grants it type by type, and an origin grants it to the notes
         * that carry it. Accepting it everywhere let a Finding or an Epic claim
         * the owner's authority for what it says, and made the schema's own
         * `evidenceAlternativeByType.resource` a no-op. */
        const allowed = [
          ...Object.entries(EVIDENCE_ALTERNATIVES)
            .filter(([, values]) => values.includes(fm.evidence))
            .map(([t]) => t),
          ...Object.entries(ORIGINS)
            .filter(([, spec]) => spec.evidenceAlternatives.includes(fm.evidence))
            .flatMap(([o, spec]) => spec.types.map((t) => `${t} with \`origin: ${o}\``)),
        ];
        err(rel, "evidence-not-allowed-for-type", `evidence \`${fm.evidence}\` is accepted only for ${allowed.join(", ")}, not for \`${type}\``);
      }

      if (origin) {
        /* `source` counts only as the list `stale-source` can check: a bare
         * string there is skipped by that rule, and the citation would never
         * be watched. */
        const has = (f) =>
          f === "source"
            ? Array.isArray(fm.source) && fm.source.some((e) => typeof e?.path === "string" && ["string", "number"].includes(typeof e?.commit))
            : present(f);
        const missing = [
          ...origin.requiredFields.filter((f) => !has(f)),
          ...(fm.lifecycle === "active" ? origin.requiredFieldsWhenActive.filter((f) => !has(f)) : []),
        ];
        const why = {
          source: "a list of {path, commit}: the file it was taken from and the commit it was read at",
          ratified: "the date the owner ratified it",
          key: "its key in the tracker it came from",
        };
        if (missing.length) {
          err(rel, "origin-incomplete", `\`origin: ${fm.origin}\` requires ${missing.map((f) => `\`${f}\`${why[f] ? ` (${why[f]})` : ""}`).join(" and ")}`);
        }
      }

      /* Metadata Schema defines these shapes; nothing used to check them, so a
       * `created: <YYYY-MM-DD>` copied from an example or `stale: yes` passed
       * as metadata that looks filled in and means nothing. */
      for (const key of ["created", "updated", "ratified"]) {
        if (fm[key] !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(String(fm[key]))) {
          err(rel, "invalid-metadata-value", `\`${key}\` is \`${fm[key]}\`, expected YYYY-MM-DD`);
        }
      }
      if (fm.stale !== undefined && typeof fm.stale !== "boolean") {
        err(rel, "invalid-metadata-value", `\`stale\` is \`${fm.stale}\`, expected true or false`);
      }
      if (fm.key !== undefined && (typeof fm.key !== "string" || fm.key.trim() === "")) {
        err(rel, "invalid-metadata-value", `\`key\` is \`${fm.key}\`, expected the tracker's key as a string — quote it if it is all digits`);
      }

      if (fm.priority && !PRIORITIES.includes(fm.priority)) {
        err(rel, "unknown-priority", `priority \`${fm.priority}\` is not defined by Metadata Schema (expected: ${PRIORITIES.join(", ")})`);
      }

      if (fm.lifecycle === "active" && !fm.evidence && !META_TYPES.includes(type)) {
        err(rel, "missing-evidence-for-active", "lifecycle is `active` but `evidence` is absent");
      }

      const floor = EVIDENCE_FLOOR[type];
      if (fm.lifecycle === "active" && floor && fm.evidence && !alternatives.includes(fm.evidence)) {
        if (EVIDENCE_LEVELS.indexOf(fm.evidence) < EVIDENCE_LEVELS.indexOf(floor)) {
          const accepted = [floor, ...alternatives].join(" or ");
          err(rel, "below-evidence-floor", `type \`${type}\` requires ${accepted} to be active, found ${fm.evidence}`);
        }
      }

      if (isScaffold(body)) {
        if (fm.lifecycle === "active") {
          err(rel, "active-scaffold", "note holds only headings but is marked active");
        } else {
          warn(rel, "scaffold", "note holds only headings");
        }
      }
    }

    for (const field of collectInlineFields(stripCodeAndInline(body))) {
      if (!RELATIONSHIP_TYPES.includes(field)) {
        err(rel, "unknown-relationship-field", `inline field \`${field}::\` is not a relationship type defined by Relationship Types`);
      }
    }
  }

  if (isVaultOwned(rel) && !inAnyFolder(rel, LINK_EXEMPT)) {
    for (const target of collectLinks(stripCodeAndInline(note.text))) {
      if (!linkResolves(target)) {
        err(rel, "broken-link", `link \`[[${target}]]\` resolves to nothing`);
        continue;
      }
      const collision = ambiguousBareLink(target);
      if (collision) {
        err(rel, "ambiguous-basename-link", `link \`[[${target}]]\` matches ${collision.length} files (${collision.join(", ")}); use the full path`);
      }
    }
  }

  /* The wikilink check above never saw `[text](path)`: a page could point at a
   * renamed file in plain Markdown and stay green. Nothing in the OS layer
   * uses that form today, which is exactly when a rule is cheap to add — the
   * first such link written is checked from the start. */
  if (isVaultOwned(rel) && !inAnyFolder(rel, MD_LINK_EXEMPT)) {
    for (const dest of collectMarkdownLinks(stripCodeAndInline(note.text))) {
      const target = markdownLinkTarget(rel, dest);
      if (target !== undefined && !existsSync(target)) {
        err(rel, "broken-md-link", `link \`(${dest})\` resolves to nothing`);
      }
    }
  }
}

/* Uncertainty ledger: an open blocking row must not point at active knowledge.
 * A link is resolved to the specific note(s) it actually addresses — the same
 * resolution Obsidian and linkResolves() use — rather than matched by basename
 * against every note in the vault. Matching by basename alone means a link
 * `[[Note]]` in a blocking row is compared against every file named "Note.md"
 * anywhere in the vault, not just the one the link actually resolves to; two
 * unrelated notes sharing a basename (one draft, one active) then produce a
 * false blocking-uncertainty-on-active on the draft one even though the link
 * never addressed the active note at all. */
for (const [rel, note] of notes) {
  /* Governed notes only: a page that merely talks about the ledger (Docs/,
   * a template, a Plan) is not one. Code is stripped first, so a table shown
   * as an example inside a fence or backticks is not read as a live row. */
  if (!isGoverned(rel)) continue;
  if (!/uncertaint/i.test(rel)) continue;
  for (const line of stripCodeAndInline(note.body).split("\n")) {
    if (!line.trim().startsWith("|")) continue;
    const cells = line.split("|").map((c) => c.trim());
    const isOpen = cells.some((c) => c.toLowerCase() === "open");
    const isBlocking = cells.some((c) => /^(yes|true|blocking)$/i.test(c));
    if (!isOpen || !isBlocking) continue;
    for (const target of collectLinks(line)) {
      for (const otherRel of resolveLinkTargets(target)) {
        const other = notes.get(otherRel);
        if (other?.fm?.lifecycle === "active") {
          err(rel, "blocking-uncertainty-on-active", `open blocking uncertainty refers to active knowledge \`${otherRel}\``);
        }
      }
    }
  }
}

/* An Epic's status is derived from its tasks, and nothing else in the system
 * derives it. `contains::` already names every Task the Epic owns, and each
 * Task carries its own `status` — so "every contained Task is finished" is a
 * fact the vault already states, and an Epic that still says `planned` while
 * all of its Tasks say `done` is a statement contradicted by its own links.
 *
 * This matters beyond tidiness: an Epic left behind also stays `draft`, and a
 * draft Epic is invisible to blocking-uncertainty-on-active — an open blocking
 * uncertainty pointing at it fires nothing. The gate that is supposed to stop
 * work on unresolved questions is switched off by a stale status field. */
const EPIC_TERMINAL_TASK_STATUS = ["done", "cancelled"];

for (const [rel, note] of notes) {
  if (!isGoverned(rel)) continue;
  if (typeOf(note.fm) !== "epic") continue;

  const taskStatuses = [];
  for (const line of note.body.split("\n")) {
    if (!/^(?:[-*+]\s+)?contains::/.test(line.trim())) continue;
    for (const target of collectLinks(line)) {
      for (const otherRel of resolveLinkTargets(target)) {
        const other = notes.get(otherRel);
        if (typeOf(other?.fm) === "task") taskStatuses.push(other.fm.status);
      }
    }
  }
  if (taskStatuses.length === 0) continue;

  const allFinished = taskStatuses.every((s) => EPIC_TERMINAL_TASK_STATUS.includes(s));
  const epicStatus = note.fm.status;

  if (allFinished && epicStatus !== "done") {
    err(
      rel,
      "epic-status-behind-tasks",
      `all ${taskStatuses.length} contained Tasks are ${EPIC_TERMINAL_TASK_STATUS.join("/")} but the Epic is still \`${epicStatus}\``
    );
  }
  if (!allFinished && epicStatus === "done") {
    const open = taskStatuses.filter((s) => !EPIC_TERMINAL_TASK_STATUS.includes(s)).length;
    err(rel, "epic-status-ahead-of-tasks", `Epic is \`done\` but ${open} contained Task(s) are not`);
  }
}

/* A settled status with `lifecycle: draft` says two opposite things, and the
 * disagreement is invisible: the evidence floor and
 * blocking-uncertainty-on-active only look at `active` notes, so a `done` Task
 * closes with no evidence and a draft Epic switches the uncertainty gate off
 * for itself.
 *
 * This was two rules, one per type, and the class came back on the type that
 * had none: ADR-001/002 were `accepted` + `draft` in 2026-09, ADR-003/004/005
 * the same a month later. Which statuses settle a note is data now
 * (`activeLifecycleStatuses`), so a type joins the rule without another loop. */
for (const [rel, note] of notes) {
  if (!isGoverned(rel)) continue;
  const settled = ACTIVE_LIFECYCLE_STATUSES[typeOf(note.fm)];
  if (!settled || !settled.includes(note.fm.status)) continue;
  if (note.fm.lifecycle !== "draft") continue;

  err(
    rel,
    "lifecycle-behind-status",
    `${typeOf(note.fm)} is \`${note.fm.status}\` but \`lifecycle\` is still \`draft\`, so neither the evidence floor nor blocking-uncertainty-on-active applies to it`
  );
}

/* A number is taken by whoever writes the next file, and two branches each
 * write "the next one": two people who open a Task on the same day both get
 * T53. Git sees two different files and merges them without a word, so the
 * collision outlives the merge — two Tasks answer to one number, and a link,
 * a branch name or `--take T53` reaches either. This is where every way of
 * working with branches meets: whatever the flow, the merged tree is checked
 * here, in pre-push or CI, before anyone builds on the ambiguity.
 *
 * Numbered notes are Tasks, Epics and Decisions (`T07-…`, `E03-…`,
 * `ADR-006-…`), grouped per type and compared by value, so `T7` and `T07`
 * collide. A tracker key (`key:`) is one Task's or Epic's too. Rows of the
 * uncertainty ledger are numbered `U-NNN` in their first cell. The first file
 * in each group keeps the number; every other one is reported. */
const NUMBERED_TYPES = ["task", "epic", "decision"];
const numberGroups = new Map();
const claim = (key, rel, what) => numberGroups.set(key, [...(numberGroups.get(key) ?? []), { rel, what }]);

for (const [rel, note] of notes) {
  if (!isGoverned(rel)) continue;
  const type = typeOf(note.fm);
  if (NUMBERED_TYPES.includes(type)) {
    const m = /^([A-Za-z]+-?)(\d+)(?=[-_ .]|$)/.exec(rel.split(sep).pop().replace(/\.md$/, ""));
    if (m) claim(`${type}\0${m[1].toUpperCase()}${Number(m[2])}`, rel, `${m[1]}${m[2]}`);
    if ((type === "task" || type === "epic") && typeof note.fm?.key === "string") claim(`key\0${note.fm.key}`, rel, `key \`${note.fm.key}\``);
  }
  if (/uncertaint/i.test(rel)) {
    for (const line of stripCodeAndInline(note.body).split("\n")) {
      const id = /^\|\s*(U-\d+)\s*\|/.exec(line.trim());
      if (id) claim(`ledger\0${rel}\0${id[1]}`, rel, `row ${id[1]}`);
    }
  }
}
for (const group of numberGroups.values()) {
  if (group.length < 2) continue;
  const [first, ...rest] = group.sort((a, b) => a.rel.localeCompare(b.rel));
  for (const g of rest) {
    const where = g.rel === first.rel ? "earlier in this file" : `\`${first.rel}\``;
    err(g.rel, "duplicate-number", `${g.what} is already used by ${where}; two branches each took "the next one". Renumber this one and the links to it`);
  }
}

/* Current-Context.md was one person's session state in a file every session
 * rewrote: with two people on two branches, every merge conflicted there and
 * one side's state was lost. Since os-v8 it holds only what the project
 * shares, and a working copy's Task is a cursor (task-lookup.mjs). The two
 * sections that made it personal are the mark of the old shape. A warning:
 * the move is a judgment about where each part goes, made with the owner. */
for (const [rel, note] of notes) {
  if (!isGoverned(rel) || rel.split(sep).pop() !== "Current-Context.md") continue;
  const old = [...stripCodeAndInline(note.body).matchAll(/^## (Current Task|Current Goal)\s*$/gm)].map((m) => `\`## ${m[1]}\``);
  if (old.length) {
    warn(rel, "current-context-old-shape", `${old.join(" and ")} hold one working copy's session state in a file every session shares; move them as Project-OS/06-AI/AI.md, "Current Context from before os-v8", says`);
  }
}

/* D18: every file in the OS layer must be named by `os-manifest`.
 *
 * The manifest is what delivery is defined against: `os-patch.mjs` carries
 * and `upgrade.mjs` updates only what it lists. A
 * file in the OS layer that no line covers is therefore invisible to delivery
 * — it never travels, and the two copies drift apart with nothing to say so.
 *
 * This is not hypothetical. `Knowledge-OS/Context Index.md` was outside the
 * manifest, and the upstream copy still carries the `Context Expansion` and
 * `Stop` sections that D10 deleted here — a decision silently reverted, found
 * only by diffing the two clones by hand. The audit's other four escapees
 * were `os-manifest` itself, `README.md`, `Knowledge BD.base`, `QA.md` and
 * `CHANGELOG.md`.
 *
 * An error, not a warning, and this is the one place in this file where that
 * is the cheaper choice: the failure it prevents is silent divergence between
 * repositories, which surfaces weeks later as "why did that come back". A new
 * OS-layer file is added deliberately, by someone who can add a manifest line
 * in the same commit, so the cost of being strict is one line at the moment
 * the author already has the context.
 *
 * `!` lines are exclusions, and `Project-OS/Templates/Task.md` is the standing
 * one: CHANGELOG records it as a permanent divergence (13 sections here
 * against the template's 6), so it is deliberately not delivered. */
const MANIFEST_PATH = join(VAULT, "Knowledge-OS", "os-manifest");
const OS_LAYER_PREFIXES = [join("Knowledge-OS") + sep, join("Project-OS", "Templates") + sep];

function manifestToRegExp(pattern) {
  let out = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
      } else {
        out += "[^/]*";
      }
    } else if (".+^${}()|[]\\?".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  return new RegExp("^" + out + "$");
}

let manifestInclude = null;

if (existsSync(MANIFEST_PATH)) {
  const lines = readFileSync(MANIFEST_PATH, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));
  const include = lines.filter((l) => !l.startsWith("!")).map(manifestToRegExp);
  const exclude = lines.filter((l) => l.startsWith("!")).map((l) => manifestToRegExp(l.slice(1)));
  manifestInclude = include;

  for (const rel of allFiles) {
    if (!OS_LAYER_PREFIXES.some((p) => rel.startsWith(p))) continue;
    const posix = rel.split(sep).join("/");
    if (exclude.some((r) => r.test(posix))) continue;
    if (include.some((r) => r.test(posix))) continue;
    err(
      rel,
      "os-layer-outside-manifest",
      "file is in the OS layer but no `os-manifest` line covers it, so delivery will not carry it"
    );
  }
}

/* Docs/ travels with the OS layer, so a page may point only at what travels
 * too: a path the manifest covers, another page of Docs/, or a file every copy
 * keeps for itself (README.md, CLAUDE.md…). A link into this project's own
 * Tasks or Findings resolves here and nowhere else.
 *
 * The convention is as old as Docs/ (os-manifest says so beside its `Docs/**`
 * line), but nothing held it locally: a page that broke it passed here and
 * failed only in upstream, at the `/mv-sync` step, which is the most expensive
 * place to find it. `!` exclusions do not make a target illegal — the
 * permanent divergences they mark (Templates/Task.md) exist in every copy,
 * just in different shapes. Broken links are left to broken-link and
 * broken-md-link; this rule judges only links that resolve.
 *
 * PER_COPY_FILES in Tools/manifest.mjs is the same list; keep the two in step.
 * It is repeated rather than imported because the validator is tested by
 * copying this one file into each fixture. */
const PER_COPY_FILES = ["CLAUDE.md", "README.md", ".os-version", ".obsidian/app.json", ".obsidian/templates.json", "Backlog.md"];

/* The vault-relative POSIX paths a wikilink addresses, by the same resolution
 * linkResolves() uses: an exact or suffix path, or every note with the basename. */
function wikilinkTargetPaths(target) {
  const norm = target.split("\\").join("/").replace(/\.md$/, "");
  if (norm.includes("/")) return pathLinkCandidates(norm, ownedFilePaths);
  const out = new Set();
  if (pathSet.has(norm + ".md")) out.add(norm + ".md");
  if (pathSet.has(norm)) out.add(norm);
  for (const p of byBasename.get(norm) || []) out.add(p.split(sep).join("/"));
  return [...out];
}

if (manifestInclude) {
  const travels = (posix) =>
    posix.startsWith("Docs/") || PER_COPY_FILES.includes(posix) || manifestInclude.some((r) => r.test(posix));
  for (const [rel, note] of notes) {
    if (rel.split(sep)[0] !== "Docs") continue;
    const text = stripCodeAndInline(note.text);
    const targets = new Map(); // posix target → how the page wrote it
    for (const t of collectLinks(text)) for (const p of wikilinkTargetPaths(t)) targets.set(p, `[[${t}]]`);
    for (const dest of collectMarkdownLinks(text)) {
      const abs = markdownLinkTarget(rel, dest);
      if (abs === undefined || !existsSync(abs)) continue;
      targets.set(relative(VAULT, abs).split(sep).join("/"), `(${dest})`);
    }
    for (const [posix, written] of targets) {
      if (posix.startsWith("../")) {
        err(rel, "docs-link-outside-os-layer", `link \`${written}\` leaves the vault; no other copy of the OS has \`${posix}\``);
      } else if (!travels(posix)) {
        err(rel, "docs-link-outside-os-layer", `link \`${written}\` points at \`${posix}\`, which the OS layer does not carry; upstream has no such file`);
      }
    }
  }
}

/* Every tool, command, hook and distributable file of the OS layer is named
 * on at least one page of Docs/. The owner's definition of done for any change
 * to the OS (Docs/10-Extending.md) starts with "documentation is current", and
 * the cheapest half of that a machine can see is whether a thing is mentioned
 * at all: a tool nobody describes is a tool the next reader rediscovers from
 * its source.
 *
 * A mention is the file name — `adopt.mjs`, `budget-audit.cjs` — or, for a
 * command, its name without `.md`, which is how Docs write it (`/mv-check`).
 * Code spans count: Docs name files in backticks.
 *
 * Only a vault that carries the OS's own documentation is held to it, and
 * `Docs/00-Index.md` is what marks one. A fixture with a stray Docs/ page, or
 * a project that keeps notes in a Docs folder of its own, has no index and is
 * not asked to describe the validator copied into it. */
const DOCS_INDEX = join(VAULT, "Docs", "00-Index.md");

if (existsSync(DOCS_INDEX)) {
  const docsText = [...notes]
    .filter(([rel]) => rel.split(sep)[0] === "Docs")
    .map(([, note]) => note.text)
    .join("\n");
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mentioned = (word) => new RegExp(`(^|[^A-Za-z0-9_.-])${escape(word)}(?![A-Za-z0-9_-])`, "m").test(docsText);
  const filesIn = (...parts) => {
    try {
      return readdirSync(join(VAULT, ...parts), { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
    } catch {
      return [];
    }
  };

  const items = []; // [vault-relative path, the word Docs must contain]
  for (const n of filesIn("Knowledge-OS", "Tools")) {
    if (/\.(mjs|cjs)$/.test(n) && !n.endsWith(".test.mjs")) items.push([join("Knowledge-OS", "Tools", n), n]);
  }
  for (const n of filesIn("Knowledge-OS", "Dist", "commands")) {
    if (/^mv-.+\.md$/.test(n)) items.push([join("Knowledge-OS", "Dist", "commands", n), n.replace(/\.md$/, "")]);
  }
  for (const n of filesIn("Knowledge-OS", "Dist", "hooks")) {
    if (!n.includes(".test.")) items.push([join("Knowledge-OS", "Dist", "hooks", n), n]);
  }
  for (const n of filesIn("Knowledge-OS", "Dist")) items.push([join("Knowledge-OS", "Dist", n), n]);

  for (const [rel, word] of items) {
    if (!mentioned(word)) {
      err(rel, "undocumented-os-file", `no page under Docs/ mentions \`${word}\`; describe it where its neighbours are described`);
    }
  }
}

/* The `.mvignore` guard rails, reported as findings rather than enforced
 * silently: an exclusion nobody can see is an exclusion nobody reviews.
 *
 * Excluding the OS layer is an error because it would let
 * os-layer-outside-manifest — the rule that keeps delivery honest — be
 * switched off by one line in a file nobody reviews. An unused line is a
 * warning because a stale ignore is how these files stop describing the
 * tree they claim to describe. */
for (const line of mvignoreLines) {
  const bare = line.replace(/[*\\/]+$/, "").split(sep).join("/");
  const protectedPrefixes = PROTECTED_FROM_IGNORE.map((x) => x.split(sep).join("/"));
  if (protectedPrefixes.some((x) => bare === x || bare.startsWith(x + "/") || x.startsWith(bare + "/"))) {
    err(
      ".mvignore",
      "mvignore-excludes-os-layer",
      `line \`${line}\` would exclude part of the OS layer, which no vault may skip`
    );
  } else if (!mvignoreUsed.has(line)) {
    warn(".mvignore", "mvignore-line-unused", `line \`${line}\` matched nothing; it may have outlived its reason`);
  }
}

/* mvos.config.json: the settings one copy of the OS keeps for its project —
 * today the project's language and the language of its notes, which the
 * Communication Rules read. Before it, the rules said "Russian" for every
 * project the OS was installed into; now the OS layer names no language and
 * the copy names its own. A key nobody reads, or a value no rule recognises,
 * is the quiet failure: the assistant falls back to guessing and nothing says
 * so. The message lists what is valid, because the reader who sees it is
 * about to type the fix. */
const CONFIG_PATH = join(VAULT, "mvos.config.json");
const CONFIG_KEYS = {
  format: { ok: (v) => v === 1, expected: "1" },
  language: { ok: (v) => typeof v === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(v), expected: "a language tag such as ru, en, de or pt-BR" },
  notes: { ok: (v) => ["language", "english", "split"].includes(v), expected: "language, english or split" },
  /* How Tasks are named and which comes next. `sequence` numbers them T01,
   * T02… and the lowest free number is next; `external` names a Task by its
   * key in the project's tracker, and the next one is the one a human names.
   * The first real installation needed the second and built it by hand.
   * `staleDays`: after how many days without a change task-lookup.mjs calls
   * a taken Task possibly abandoned (14 when absent). */
  tasks: {
    ok: (v) =>
      Boolean(v) &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      Object.keys(v).every((k) => ["keying", "keyPattern", "next", "staleDays"].includes(k)) &&
      (v.keying === undefined || ["sequence", "external"].includes(v.keying)) &&
      (v.next === undefined || ["lowest-number", "explicit"].includes(v.next)) &&
      (v.keyPattern === undefined || (typeof v.keyPattern === "string" && compiles(v.keyPattern))) &&
      (v.staleDays === undefined || (Number.isInteger(v.staleDays) && v.staleDays > 0)),
    expected: '{"keying": "sequence" | "external", "keyPattern": "<regular expression>", "next": "lowest-number" | "explicit", "staleDays": <days, a positive integer>}, every key optional',
  },
};

function compiles(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

if (existsSync(CONFIG_PATH)) {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    err("mvos.config.json", "invalid-config", `not valid JSON: ${e.message.split("\n")[0]}`);
  }
  if (cfg !== undefined) {
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) {
      err("mvos.config.json", "invalid-config", "must be a JSON object");
    } else {
      for (const [key, v] of Object.entries(cfg)) {
        const spec = CONFIG_KEYS[key];
        if (!spec) err("mvos.config.json", "invalid-config", `unknown key \`${key}\`; known: ${Object.keys(CONFIG_KEYS).join(", ")}`);
        else if (!spec.ok(v)) err("mvos.config.json", "invalid-config", `\`${key}\` is ${JSON.stringify(v)}; expected ${spec.expected}`);
      }
      /* A key that does not look like the tracker's is most often a typo
       * that will never match the ticket again. */
      const pattern = CONFIG_KEYS.tasks.ok(cfg.tasks) ? cfg.tasks?.keyPattern : undefined;
      if (pattern) {
        const re = new RegExp(pattern);
        for (const [rel, note] of notes) {
          if (!isGoverned(rel) || !["task", "epic"].includes(typeOf(note.fm)) || typeof note.fm?.key !== "string") continue;
          if (!re.test(note.fm.key)) err(rel, "invalid-metadata-value", `\`key\` is \`${note.fm.key}\`, which does not match \`tasks.keyPattern\` (${pattern}) in mvos.config.json`);
        }
      }
    }
  }
}

/* The deployed copy must match its source, or the source stops being the source.
 *
 * Slash commands and the budget hook have to exist at the project root for
 * Claude Code to load them, and inside `Knowledge-OS/Dist/` for delivery to
 * carry them — the root `.claude/` is outside the vault by
 * construction, so one canonical location cannot serve both. That leaves two
 * copies, and two copies maintained by intention drift: this repository has
 * already paid for that once, when a user-level `/mv-close` spent a month
 * describing a three-question ritual that no longer existed, and the gap
 * surfaced only when someone read the stale copy as authoritative.
 *
 * Duplication a program checks is not the same defect as duplication a human
 * promises to maintain. This is that check.
 *
 * Only `mv-*` names are compared: the prefix is a reserved namespace, and a
 * host project's own `.claude/commands/deploy.md` is none of this validator's
 * business.
 *
 * The level split is deliberate. Drift is an error — it is the silent
 * divergence the rule exists to catch. A missing deployment is a WARNING,
 * because a vault that is not an installed project legitimately has no
 * `.claude/` at all: the upstream distribution repository is exactly that, and
 * making absence an error would turn its validator red on the day this ships,
 * which is how a gate teaches its reader to stop looking. */
/* The hook's name, under any of the extensions it has had: `budget-audit.mjs`
 * until 2026-10-25, `budget-audit.cjs` since. Dist holds only the current one,
 * so a deployed `.mjs` left over from before has no source here and is reported
 * as undeployed-command-source — which is exactly what it is. */
const DEPLOYABLE = [
  ["commands", (n) => /^mv-[^/]+\.md$/.test(n)],
  ["hooks", (n) => /^budget-audit\.(cjs|mjs)$/.test(n)],
];

/* The distribution copy — the vault is its own repository root and there is
 * no `.claude/` anywhere — is not an installed project, and nothing in it is
 * undeployed by mistake. It used to print one `deployed-command-missing` per
 * source, twelve on every clean clone: a warning that is always on is the one
 * the reader learns to skip. It now says so once, in the summary. An embedded
 * vault with no `.claude/` above it still warns: there the commands are
 * genuinely missing from the project that should load them. */
let distributionCopy = false;

if (existsSync(join(VAULT, DIST_PATH))) {
  const deployRoot = findClaudeDir();
  distributionCopy = !INSTALL && !deployRoot && existsSync(join(VAULT, ".git"));
  for (const [kind, matches] of distributionCopy || PLUGIN_INSTALL ? [] : DEPLOYABLE) {
    const sourceDir = join(VAULT, DIST_PATH, kind);
    let names;
    try {
      names = readdirSync(sourceDir).filter(matches);
    } catch {
      continue;
    }

    for (const name of names) {
      const rel = join("Knowledge-OS", "Dist", kind, name);
      if (!deployRoot) {
        warn(rel, "deployed-command-missing", `no \`.claude/\` to deploy into; \`${kind}/${name}\` is undeployed`);
        continue;
      }
      const target = join(deployRoot, kind, name);
      if (!existsSync(target)) {
        warn(rel, "deployed-command-missing", `\`.claude/${kind}/${name}\` does not exist; the deployed copy is missing`);
        continue;
      }
      const a = readFileSync(join(VAULT, rel), "utf8").replace(/\r\n/g, "\n");
      const b = readFileSync(target, "utf8").replace(/\r\n/g, "\n");
      if (a !== b) {
        err(rel, "deployed-command-drift", `\`.claude/${kind}/${name}\` differs from this source; one of the two is stale`);
      }
    }

    /* The mirror case: something deployed under a name this OS owns, with no
     * source behind it. Usually a command left over from an older version,
     * which will keep being loaded by Claude Code and answer for a system that
     * no longer describes it that way. */
    if (deployRoot) {
      let deployed;
      try {
        deployed = readdirSync(join(deployRoot, kind)).filter(matches);
      } catch {
        deployed = [];
      }
      for (const name of deployed) {
        if (names.includes(name)) continue;
        warn(
          `(.claude) ${kind}/${name}`,
          "undeployed-command-source",
          `nothing under \`Knowledge-OS/Dist/${kind}/\` produces this file; it may be from an older version`
        );
      }
    }
  }
}

/* B8: an `active` note whose cited evidence has moved is unverified.
 *
 * `source: [{path, commit}]` says which repository state a statement was
 * established against, so `git log <commit>..HEAD -- <path>` answers whether
 * that state still holds. This rule reports the answer; `Tools/stale-check.mjs`
 * is the same question asked in detail, with the commits named.
 *
 * A WARNING, and the distinction it rests on is the point: stale evidence does
 * not make knowledge wrong, it makes it unchecked. Failing the build for it
 * would stop work over notes that may well still be accurate, and the rule
 * would be switched off within a week — which is precisely what happened to
 * the `stale` frontmatter field this replaces, described in Metadata Schema as
 * "set and cleared by hand" and never once set.
 *
 * Only `active` notes are checked. A draft states nothing the vault is
 * standing behind yet, so there is no claim to have gone unverified.
 *
 * Shelling out to git per entry is affordable — `source` exists on a couple of
 * dozen notes — and the alternative, reimplementing reachability over the
 * object graph, would be a second thing to keep correct. When it stops being
 * affordable, batch by commit rather than by note: the same commit repeats
 * across many entries. */
/* The repository root is the nearest ancestor holding `.git`, starting at the
 * vault itself — not `dirname(VAULT)`. Both layouts are real: this vault is a
 * subfolder of a larger project, while the upstream distribution repository IS
 * its own vault root. Assuming the parent silently interrogated the wrong
 * repository there for as long as the assumption stood. Falling back to VAULT
 * rather than throwing keeps fixture vaults, which have no git history of
 * their own, working. */
function findRepoRoot(start) {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, ".git"))) return dir;
    if (dirname(dir) === dir) return start;
  }
}

/* With an install record the search starts at the project root it names, so
 * a vault with its own .git still asks the project's repository about the
 * project's files (Backlog, 2026-09-17). */
const REPO_ROOT = findRepoRoot(PROJECT_ROOT ?? VAULT);

function commitsTouching(commit, path) {
  const opts = { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  try {
    const out = execFileSync("git", ["log", "--format=%h", `${commit}..HEAD`, "--", path], opts);
    const count = out.split("\n").filter(Boolean).length;
    /* `git log -- <path>` does not fail on a path git has never seen: it
     * answers "no commits", which reads exactly like "still current". A typo
     * in `source.path` then passed as evidence for as long as nobody looked.
     * A path no commit has touched since the cited one must still exist at
     * HEAD; if it does not, the citation names nothing. */
    if (count === 0) execFileSync("git", ["cat-file", "-e", `HEAD:${path}`], opts);
    return count;
  } catch {
    /* Unanswerable rather than clean: an unknown commit or a path that exists
     * nowhere in HEAD. Reported separately below — a broken reference silently
     * read as "still current" is the failure this rule exists to prevent. */
    return null;
  }
}

for (const [rel, note] of notes) {
  if (!isGoverned(rel)) continue;
  if (note.fm?.lifecycle !== "active") continue;
  const source = note.fm?.source;
  if (!Array.isArray(source) || source.length === 0) continue;

  for (const entry of source) {
    if (entry && typeof entry.path === "string" && typeof entry.commit === "number") {
      /* An all-digit short hash written unquoted is a YAML number, and its
       * leading zeros are already gone, so it cannot be recovered here. */
      warn(rel, "stale-source", `\`source\` commit for \`${entry.path}\` was read as the number ${entry.commit}; quote the hash`);
      continue;
    }
    if (!entry || typeof entry.path !== "string" || typeof entry.commit !== "string") {
      warn(rel, "stale-source", "`source` entry is missing a string `path` or `commit`");
      continue;
    }
    const count = commitsTouching(entry.commit, entry.path);
    if (count === null) {
      warn(rel, "stale-source", `\`source\` cites \`${entry.path}\` at \`${entry.commit}\`, which this repository cannot resolve`);
    } else if (count > 0) {
      warn(
        rel,
        "stale-source",
        `\`${entry.path}\` has ${count} commit(s) since \`${entry.commit}\` — evidence unverified, not necessarily wrong`
      );
    }
  }
}

/* Knowledge Maintenance Protocol §3 requires that "no entity that should be
 * reachable is orphaned". Nothing checked it, so the promise had no teeth.
 *
 * "Should be reachable" is the whole difficulty, and it is answered by type,
 * not by counting links. Meta types are entry points by construction — a
 * README, an index, a schema, a rule, a protocol is something you navigate
 * *from*, and a vault where every rule had to be linked from somewhere else
 * would be a vault with a link graph built to satisfy a validator. Everything
 * else earns its place in the graph by being referenced: a Task nobody links
 * to is a Task nobody can reach from the Epic that supposedly contains it.
 *
 * This is a WARNING, deliberately. On a real vault it fires on notes that are
 * perfectly correct but simply young — a Finding written this session has no
 * inbound link yet and may never need one. Turning that into an error would
 * make the validator red for a condition nobody should rush to fix, and a
 * validator that is normally red teaches its reader to stop looking. The
 * count is data about how knowledge is actually connected; it is not a defect
 * list. Reachability is resolved with resolveLinkTargets(), the same Obsidian
 * resolution used everywhere else here, so a bare-basename link counts as
 * reaching every note that shares that basename — over-counting inbound links
 * is the safe direction for a rule whose false positives are the expensive
 * kind. */
const inboundLinks = new Set();

for (const [rel, note] of notes) {
  if (isTemplate(rel)) continue;
  /* A foreign tree's link does not make a note of this vault reachable: the
   * link resolves in a graph this vault was never shown. */
  if (!isVaultOwned(rel)) continue;
  for (const target of collectLinks(stripCodeAndInline(note.text))) {
    for (const otherRel of resolveLinkTargets(target)) {
      if (otherRel !== rel) inboundLinks.add(otherRel);
    }
  }
}

for (const [rel, note] of notes) {
  /* isGoverned, not just isTemplate: walk() covers the whole vault, so `notes`
   * also holds files under Metrics/ and Plans/ — a written record and working
   * documents, sitting outside Knowledge-OS and Project-OS on purpose. They
   * are nobody's link target by design, and warning about them would bury the
   * three real signals under noise from files the schema does not govern. */
  if (!isGoverned(rel)) continue;
  /* Project-OS only. Knowledge-OS is the operating system's own text — rules,
   * protocols and schemas that are navigated from README and from each other,
   * and whose reachability is a property of the shipped OS rather than of this
   * project's knowledge. Project-OS is where a note going unreferenced is
   * actually a defect: a Task no Epic contains, a Decision nothing cites. */
  if (rel.split(sep)[0] !== "Project-OS") continue;
  const type = typeOf(note.fm);
  if (!type || META_TYPES.includes(type)) continue;
  if (inboundLinks.has(rel)) continue;
  warn(rel, "orphaned-note", `no other note links to this \`${type}\`; it is reachable only by knowing its path`);
}

/* .claude/commands/*.md are outside the vault (a sibling of it, or of
 * VAULT's parent — see findClaudeDir) and outside walk()'s scope entirely
 * (walk() skips every dotfile, on purpose, for note-schema scanning). But
 * they carry the same [[wikilinks]] into the vault that notes do — mv-note.md
 * and mv-close.md both link into Project-OS/Templates/Finding, for instance —
 * and a rename on the vault side breaks those links exactly as silently as it
 * would inside a note, just without this validator ever having looked. */
function walkClaudeMarkdown(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walkClaudeMarkdown(full, out);
    else if (entry.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const claudeDir = findClaudeDir();
if (claudeDir) {
  for (const full of walkClaudeMarkdown(claudeDir)) {
    const posix = relative(claudeDir, full).split(sep).join("/");
    /* This vault's own deployed commands only. The rule exists because
     * mv-note.md and mv-close.md link into Project-OS/Templates/Finding and a
     * rename on the vault side would break them silently — that argument
     * covers files this OS put there, and nothing else. A host project's
     * .claude/agents/reviewer.md links into its own documentation, which this
     * vault has never seen; judging it here reports a working link as broken.
     * `mv-` is the reserved namespace, so the prefix is the whole test. */
    if (!/^commands\/mv-[^/]+\.md$/.test(posix)) continue;
    const rel = "(.claude) " + posix;
    const text = readFileSync(full, "utf8");
    for (const target of collectLinks(stripCodeAndInline(text))) {
      if (!linkResolves(target)) {
        err(rel, "broken-link", `link \`[[${target}]]\` resolves to nothing`);
        continue;
      }
      const collision = ambiguousBareLink(target);
      if (collision) {
        err(rel, "ambiguous-basename-link", `link \`[[${target}]]\` matches ${collision.length} files (${collision.join(", ")}); use the full path`);
      }
    }
  }
}

/* *.base files declare filter conditions as bare expression strings (Bases'
 * own query language), e.g. `file.folder == "Project-OS/03-Development/Tasks"`
 * — not YAML structure, so there is no `file.folder` key to walk to; each
 * condition has to be read out of the string itself. Bases silently shows an
 * empty table if that folder doesn't exist — indistinguishable from
 * "correctly empty" — so a renamed Tasks/ folder would break the view without
 * anything ever failing loudly. *.base is otherwise YAML, parseable the same
 * way frontmatter is. */
const baseFiles = allFiles.filter((f) => f.endsWith(".base"));
const FILE_FOLDER_CONDITION = /file\.folder\s*==\s*["']([^"']+)["']/g;
function collectBaseFolderConditions(node, out = []) {
  if (Array.isArray(node)) {
    for (const item of node) collectBaseFolderConditions(item, out);
  } else if (node && typeof node === "object") {
    for (const value of Object.values(node)) collectBaseFolderConditions(value, out);
  } else if (typeof node === "string") {
    let m;
    FILE_FOLDER_CONDITION.lastIndex = 0;
    while ((m = FILE_FOLDER_CONDITION.exec(node)) !== null) out.push(m[1]);
  }
  return out;
}
for (const rel of baseFiles) {
  let parsed;
  try {
    parsed = loadYaml(readFileSync(join(VAULT, rel), "utf8"));
  } catch (e) {
    err(rel, "invalid-yaml-frontmatter", `*.base file is not valid YAML: ${e instanceof YAMLException ? e.message : String(e)}`);
    continue;
  }
  for (const folder of collectBaseFolderConditions(parsed)) {
    if (!statSync(join(VAULT, folder), { throwIfNoEntry: false })?.isDirectory()) {
      err(rel, "broken-base-folder", `file.folder \`${folder}\` does not exist`);
    }
  }
}

// ---------------------------------------------------------------- report

if (JSON_OUT) {
  console.log(JSON.stringify({ errors, warnings, notes: notes.size, distributionCopy, installMode: INSTALL?.mode ?? null }, null, 2));
} else {
  const group = (rows) => {
    const byFile = new Map();
    for (const r of rows) {
      if (!byFile.has(r.file)) byFile.set(r.file, []);
      byFile.get(r.file).push(r);
    }
    for (const [file, rs] of [...byFile].sort()) {
      console.log(`  ${file}`);
      for (const r of rs) console.log(`    [${r.rule}] ${r.message}`);
    }
  };

  const governedCount = [...notes.keys()].filter(isGoverned).length;
  console.log(`Scanned ${notes.size} markdown files, ${governedCount} of them governed notes under ${KNOWLEDGE_ROOTS.join(", ")}${mvignoreExcluded ? ` (${mvignoreExcluded} path(s) excluded by .mvignore)` : ""}.`);
  if (distributionCopy) {
    console.log("Distribution copy: the vault is its own repository and has no .claude/, so Knowledge-OS/Dist/ is not checked for deployment.");
  }
  if (PLUGIN_INSTALL) {
    console.log("Personal install: commands and hook come from the plugin `mv`, so Knowledge-OS/Dist/ is not compared with .claude/.");
  }
  console.log("");
  if (errors.length) {
    console.log(`ERRORS (${errors.length})`);
    group(errors);
    console.log("");
  }
  if (warnings.length) {
    console.log(`WARNINGS (${warnings.length})`);
    group(warnings);
    console.log("");
  }
  console.log(errors.length ? `FAILED — ${errors.length} error(s).` : "OK — no schema violations.");
}

process.exit(errors.length ? 1 : 0);
