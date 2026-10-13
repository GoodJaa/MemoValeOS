#!/usr/bin/env node
/*
 * Context provider for MemoValeOS: a generic read-and-propose interface for
 * any external tool that needs project knowledge from this vault. The wire
 * format is defined by Protocols/Context-Provider-Protocol.md.
 *
 * The process boundary is deliberately narrow: one protocol 1.0 JSON request
 * arrives on stdin and one JSON response leaves on stdout. Retrieval is
 * bounded to explicit vault entry points. Checkpoints contain references and
 * digests, never note bodies. Knowledge operations produce proposals only.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { load as loadYaml } from "js-yaml";

const PROTOCOL_VERSION = "1.0";
const PROVIDER_ID = "memovale";
const PROVIDER_VERSION = "0.1.0";
const MAX_REQUEST_BYTES = 1_048_576;
const OPERATIONS = [
  "capabilities",
  "health",
  "prepare_context",
  "checkpoint",
  "restore",
  "propose_knowledge",
];
const MANDATORY_CONTEXT = [
  "CLAUDE.md",
  "Knowledge-OS/Protocols/Context-Selection-Protocol.md",
];
/* `__fixtures__` and `__provider_fixtures__` hold test vaults — deliberately
 * shaped notes, including this adapter's own basic fixture. They are not the
 * project's knowledge, and walking them makes a fixture's `Decisions.md` show
 * up as a duplicate of the real one, which reads as a conflict in the vault
 * where there is none. `validate-vault.mjs` skips them for the same reason. */
const NEVER_WALK = new Set([
  ".git",
  ".obsidian",
  ".claude",
  "node_modules",
  "__fixtures__",
  "__provider_fixtures__",
]);
const ELIGIBLE_SUFFIXES = [".md", ".json", ".base"];
const CANDIDATE_KINDS = new Set([
  "finding",
  "decision",
  "architecture",
  "incident",
  "eval",
  "rule",
  "skill_change",
  "intent",
]);
const EVIDENCE_LEVELS = new Set(["", "L1", "L2", "L3", "L4", "user-provided"]);
/* `user-provided` is not a level; schema.json grants it per type
 * (evidenceAlternativeByType). Of the types a candidate can map to, only
 * product takes it — what a product is for is the owner's to say. */
const EVIDENCE_ALTERNATIVES = { product: ["user-provided"] };
/* Provider-Mapping names four kinds whose acceptance is a human's: Decision
 * and Architecture need it to become active at all, a rule changes the system
 * layer, and an intent is product ownership. The candidate must say so. */
const HUMAN_REVIEW_KINDS = ["decision", "architecture", "rule", "intent"];
const KIND_MAP = {
  finding: { type: "finding", folder: "Project-OS/03-Development/Findings", lifecycle: "active", status: "active", floor: "L1" },
  incident: { type: "finding", folder: "Project-OS/03-Development/Findings", lifecycle: "active", status: "active", floor: "L1" },
  skill_change: { type: "finding", folder: "Project-OS/03-Development/Findings", lifecycle: "active", status: "active", floor: "L1" },
  eval: { type: "research", folder: "Project-OS/04-Research", lifecycle: "draft", status: "open", floor: "L1" },
  decision: { type: "decision", folder: "Project-OS/05-Decisions", lifecycle: "draft", status: "proposed", floor: "L2" },
  // No `status` for architecture and product: schema.json gives them none.
  architecture: { type: "architecture", folder: "Project-OS/02-Architecture", lifecycle: "draft", floor: "L2" },
  rule: { type: "rule", folder: "Knowledge-OS/Rules", lifecycle: "draft", status: "active", floor: "" },
  intent: { type: "product", folder: "Project-OS/01-Product", lifecycle: "draft", floor: "L4" },
};

class ProviderFault extends Error {
  constructor(code, message, retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function posix(value) {
  return value.split(sep).join("/");
}

function within(root, child) {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function stableSort(values) {
  return [...values].sort((left, right) => {
    const folded = left.localeCompare(right, "en", { sensitivity: "base" });
    return folded || left.localeCompare(right, "en");
  });
}

function now(options) {
  return options.now ? options.now() : new Date().toISOString();
}

function resolveRoots(options = {}) {
  let projectRoot;
  let vaultRoot;
  try {
    projectRoot = realpathSync(resolve(options.projectRoot ?? process.cwd()));
    vaultRoot = realpathSync(resolve(options.vaultRoot ?? projectRoot));
  } catch (error) {
    throw new ProviderFault("vault-unavailable", `Project or vault root is unavailable: ${error.message}`);
  }
  if (!statSync(projectRoot).isDirectory() || !statSync(vaultRoot).isDirectory()) {
    throw new ProviderFault("vault-unavailable", "Project and vault roots must be directories.");
  }
  if (!within(projectRoot, vaultRoot)) {
    throw new ProviderFault("vault-outside-project", "MemoValeOS vault must be inside the authorized project root.");
  }
  return { projectRoot, vaultRoot };
}

function requireObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ProviderFault("invalid-request", `${label} must be an object.`);
  }
  return value;
}

function validateRequest(value) {
  const request = requireObject(value, "request");
  const allowed = new Set([
    "request_id",
    "provider_id",
    "operation",
    "payload",
    "adapter_extensions",
    "message_type",
    "protocol_version",
  ]);
  if (Object.keys(request).some((key) => !allowed.has(key))) {
    throw new ProviderFault("invalid-request", "Request contains unsupported top-level fields.");
  }
  for (const key of allowed) {
    if (!Object.hasOwn(request, key)) {
      throw new ProviderFault("invalid-request", `Request is missing ${key}.`);
    }
  }
  if (typeof request.request_id !== "string" || !request.request_id.trim()) {
    throw new ProviderFault("invalid-request", "request_id must be a nonempty string.");
  }
  if (request.provider_id !== PROVIDER_ID) {
    throw new ProviderFault("provider-identity-mismatch", `Expected provider_id ${PROVIDER_ID}.`);
  }
  if (!OPERATIONS.includes(request.operation)) {
    throw new ProviderFault("unsupported-operation", `Unsupported operation: ${request.operation}`);
  }
  if (request.message_type !== "request" || request.protocol_version !== PROTOCOL_VERSION) {
    throw new ProviderFault("invalid-request", "Only context provider protocol 1.0 requests are supported.");
  }
  requireObject(request.payload, "payload");
  requireObject(request.adapter_extensions, "adapter_extensions");
  if (request.adapter_extensions.write_mode === "managed_write") {
    throw new ProviderFault("managed-write-forbidden", "MemoValeOS provider does not perform managed writes.");
  }
  return request;
}

function response(request, status, payload = {}, warnings = [], errors = [], adapterExtensions = {}) {
  return {
    request_id: request?.request_id || "invalid-request",
    provider_id: PROVIDER_ID,
    provider_version: PROVIDER_VERSION,
    status,
    payload,
    warnings,
    errors,
    adapter_extensions: adapterExtensions,
    message_type: "response",
    protocol_version: PROTOCOL_VERSION,
  };
}

function errorResponse(request, error) {
  const fault = error instanceof ProviderFault
    ? error
    : new ProviderFault("provider-failure", error?.message || String(error));
  return response(request, "error", {}, [], [{
    code: fault.code,
    message: fault.message,
    retryable: Boolean(fault.retryable),
    protocol_version: PROTOCOL_VERSION,
  }]);
}

function health(roots) {
  const required = [
    "CLAUDE.md",
    "Knowledge-OS",
    "Project-OS",
    "Knowledge-OS/Protocols/Context-Selection-Protocol.md",
  ];
  const missing = required.filter((item) => {
    try {
      const target = realpathSync(join(roots.vaultRoot, ...item.split("/")));
      return !within(roots.vaultRoot, target);
    } catch {
      return true;
    }
  });
  if (missing.length) {
    throw new ProviderFault("invalid-vault", `MemoValeOS entry points are missing: ${missing.join(", ")}`);
  }
  return {
    healthy: true,
    obsidian_required: false,
    vault_root: posix(relative(roots.projectRoot, roots.vaultRoot)) || ".",
  };
}

function capabilitiesPayload() {
  return {
    capabilities: {
      operations: OPERATIONS,
      write_modes: ["read_only", "propose"],
      managed_write: false,
      durable: true,
      obsidian_required: false,
      context_selection: "explicit-entrypoints",
      checkpoint_storage: "reference-digest-only",
    },
  };
}

function validatePlan(plan) {
  requireObject(plan, "plan");
  const strings = ["id", "task_id", "stage", "stop_condition"];
  if (strings.some((key) => typeof plan[key] !== "string" || !plan[key].trim())) {
    throw new ProviderFault("invalid-plan", "Context plan identity, task, stage, and stop condition are required.");
  }
  if (plan.protocol_version !== PROTOCOL_VERSION) {
    throw new ProviderFault("invalid-plan", "Context plan must use protocol 1.0.");
  }
  if (!Array.isArray(plan.target_facts) || !plan.target_facts.length ||
      plan.target_facts.some((item) => typeof item !== "string" || !item.trim())) {
    throw new ProviderFault("invalid-plan", "Context plan requires nonempty target_facts.");
  }
  if (!Array.isArray(plan.provider_ids) || !plan.provider_ids.includes(PROVIDER_ID)) {
    throw new ProviderFault("provider-not-requested", "Context plan does not request MemoValeOS.");
  }
  if (!Number.isInteger(plan.max_files) || plan.max_files < 1 ||
      !Number.isInteger(plan.max_bytes) || plan.max_bytes < 1) {
    throw new ProviderFault("invalid-plan", "Context file and byte budgets must be positive integers.");
  }
  return plan;
}

function authorizedPath(roots, value) {
  if (typeof value !== "string" || !value.trim() || isAbsolute(value)) {
    throw new ProviderFault("invalid-entrypoint", `Entrypoint must be vault-relative: ${String(value)}`);
  }
  const pieces = value.replaceAll("\\", "/").split("/");
  if (pieces.some((piece) => !piece || piece === "." || piece === "..")) {
    throw new ProviderFault("invalid-entrypoint", `Entrypoint escapes or is not normalized: ${value}`);
  }
  let target;
  try {
    target = realpathSync(join(roots.vaultRoot, ...pieces));
  } catch {
    throw new ProviderFault("invalid-entrypoint", `Entrypoint is unavailable: ${value}`);
  }
  if (!within(roots.vaultRoot, target)) {
    throw new ProviderFault("invalid-entrypoint", `Entrypoint escapes the vault: ${value}`);
  }
  return target;
}

function eligible(path) {
  return ELIGIBLE_SUFFIXES.some((suffix) => path.toLowerCase().endsWith(suffix));
}

function walkFiles(roots, root, seen = new Set()) {
  const canonical = realpathSync(root);
  if (!within(roots.vaultRoot, canonical)) {
    throw new ProviderFault("invalid-entrypoint", "Entrypoint contains an escaping link.");
  }
  if (seen.has(canonical)) return [];
  seen.add(canonical);
  const info = lstatSync(root);
  if (info.isFile() || info.isSymbolicLink() && statSync(canonical).isFile()) {
    return eligible(canonical) ? [canonical] : [];
  }
  if (!statSync(canonical).isDirectory()) return [];
  const out = [];
  const entries = stableSort(readdirSync(canonical, { withFileTypes: true }).map((item) => item.name));
  for (const name of entries) {
    if (NEVER_WALK.has(name)) continue;
    const child = join(canonical, name);
    const resolved = realpathSync(child);
    if (!within(roots.vaultRoot, resolved)) {
      throw new ProviderFault("invalid-entrypoint", `Entrypoint contains an escaping link: ${name}`);
    }
    out.push(...walkFiles(roots, child, seen));
  }
  return out;
}

function frontmatter(raw) {
  if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) return {};
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return {};
  try {
    const value = loadYaml(match[1]);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return value;
  } catch (error) {
    return { _parse_error: error.message };
  }
}

function scalar(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value ?? "";
}

function gitRevision(projectRoot) {
  try {
    const value = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    if (!/^[0-9a-f]{40}$/.test(value)) throw new Error("Git returned an invalid revision.");
    return value;
  } catch (error) {
    throw new ProviderFault("git-revision-unavailable", `Cannot resolve project Git revision: ${error.message}`, true);
  }
}

/* README.md, QA.md and Docs/ describe the system to people. They are not
 * project knowledge, and CLAUDE.md tells the assistant not to load them; the
 * provider enforces the same boundary even when a caller names one. */
function isWrittenForPeople(vaultRelative) {
  return vaultRelative === "README.md" || vaultRelative === "QA.md" || vaultRelative.startsWith("Docs/");
}

function collectContextFiles(roots, entrypoints) {
  if (!Array.isArray(entrypoints) || !entrypoints.length) {
    throw new ProviderFault("invalid-entrypoint", "prepare_context requires explicit entrypoints.");
  }
  const ordered = [];
  const seen = new Set();
  for (const item of [...MANDATORY_CONTEXT, ...entrypoints]) {
    const target = authorizedPath(roots, item);
    for (const file of walkFiles(roots, target)) {
      const rel = posix(relative(roots.vaultRoot, file));
      if (isWrittenForPeople(rel) && !MANDATORY_CONTEXT.includes(rel)) continue;
      if (!seen.has(rel)) {
        seen.add(rel);
        ordered.push({ file, vaultRelative: rel });
      }
    }
  }
  return ordered;
}

function sourceMetadata(vaultRelative, raw) {
  const metadata = frontmatter(raw);
  const heading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim() || basename(vaultRelative);
  return {
    path: vaultRelative,
    title: heading,
    type: scalar(metadata.type),
    lifecycle: scalar(metadata.lifecycle),
    status: scalar(metadata.status),
    evidence: scalar(metadata.evidence),
    stale: metadata.stale === true,
    created: scalar(metadata.created),
    updated: scalar(metadata.updated),
    frontmatter_valid: !metadata._parse_error,
  };
}

function prepareContext(request, roots, observedAt) {
  const plan = validatePlan(request.payload.plan);
  const revision = gitRevision(roots.projectRoot);
  const candidates = collectContextFiles(roots, request.payload.entrypoints);
  const references = [];
  const sources = [];
  const omissions = [];
  const budgetOmissions = [];
  let selectedBytes = 0;
  for (const candidate of candidates) {
    const projectRelative = posix(relative(roots.projectRoot, candidate.file));
    const size = statSync(candidate.file).size;
    /* Lifecycle first: superseded or archived knowledge is never selected, so
     * it must not spend the budget or mark the selection as truncated. */
    const bytes = readFileSync(candidate.file);
    const metadata = sourceMetadata(candidate.vaultRelative, bytes.toString("utf8"));
    if (!MANDATORY_CONTEXT.includes(candidate.vaultRelative) &&
        ["superseded", "archived"].includes(metadata.lifecycle)) {
      omissions.push(`${candidate.vaultRelative}: lifecycle ${metadata.lifecycle}`);
      continue;
    }
    if (references.length >= plan.max_files) {
      const omission = `${candidate.vaultRelative}: file budget`;
      omissions.push(omission);
      budgetOmissions.push(omission);
      continue;
    }
    if (selectedBytes + size > plan.max_bytes) {
      const omission = `${candidate.vaultRelative}: byte budget`;
      omissions.push(omission);
      budgetOmissions.push(omission);
      continue;
    }
    const digest = sha256(bytes);
    selectedBytes += bytes.length;
    const id = `memovale-${sha256(`${projectRelative}:${digest}`).slice(0, 20)}`;
    references.push({
      id,
      kind: candidate.file.toLowerCase().endsWith(".md") ? "memovale_note" : "memovale_file",
      uri: "",
      path: projectRelative,
      native_id: candidate.vaultRelative,
      revision,
      digest: `sha256:${digest}`,
      environment_id: "memovale-vault",
      observed_at: observedAt,
      protocol_version: PROTOCOL_VERSION,
    });
    sources.push({
      reference_id: id,
      ...metadata,
    });
  }
  const titleIndex = new Map();
  for (const source of sources) {
    const key = source.title.toLocaleLowerCase("en");
    titleIndex.set(key, [...(titleIndex.get(key) ?? []), source.path]);
  }
  const contradictions = [...titleIndex.values()].filter((items) => items.length > 1);
  const staleSources = sources.filter((item) => item.stale).map((item) => item.path);
  const draftSources = sources.filter((item) => item.lifecycle === "draft").map((item) => item.path);
  const lifecycleOmissions = omissions.filter((item) => item.includes(": lifecycle "));
  const warnings = [];
  if (budgetOmissions.length) warnings.push("Context selection was truncated by the declared budget.");
  if (lifecycleOmissions.length) warnings.push("Superseded or archived knowledge was omitted.");
  if (staleSources.length) warnings.push(`Selected stale knowledge: ${staleSources.join(", ")}`);
  if (draftSources.length) warnings.push(`Selected draft knowledge: ${draftSources.join(", ")}`);
  if (contradictions.length) warnings.push("Selected sources contain duplicate titles that require conflict review.");
  if (!references.length) {
    throw new ProviderFault("no-context-sources", "No context source fit the declared retrieval budget.");
  }
  const degraded = warnings.length > 0;
  const status = degraded ? "degraded" : "ok";
  const receipt = {
    id: `receipt-${request.request_id}`,
    plan_id: plan.id,
    provider_id: PROVIDER_ID,
    provider_version: PROVIDER_VERSION,
    status,
    transport: "process",
    reference_ids: references.map((item) => item.id),
    facts: [],
    retrieved_at: observedAt,
    omissions,
    truncated: budgetOmissions.length > 0,
    cache_telemetry: null,
    warnings,
    adapter_extensions: {
      selected_files: references.length,
      selected_bytes: selectedBytes,
      stop_condition: plan.stop_condition,
      target_facts: plan.target_facts,
      mandatory_entrypoints: MANDATORY_CONTEXT,
      requested_entrypoints: request.payload.entrypoints,
      sources,
      stale_sources: staleSources,
      draft_sources: draftSources,
      lifecycle_omissions: lifecycleOmissions,
      contradictions,
      authority: "project-knowledge",
    },
    protocol_version: PROTOCOL_VERSION,
  };
  return response(request, status, { plan, receipt, references }, warnings);
}

function minimalReference(value) {
  const item = requireObject(value, "reference");
  if (typeof item.id !== "string" || !item.id || typeof item.path !== "string" || !item.path ||
      !/^sha256:[0-9a-f]{64}$/.test(item.digest ?? "")) {
    throw new ProviderFault("invalid-checkpoint", "Checkpoint references require id, relative path, and SHA-256 digest.");
  }
  return {
    id: item.id,
    kind: item.kind ?? "memovale_note",
    path: item.path,
    native_id: item.native_id ?? "",
    revision: item.revision ?? "",
    digest: item.digest,
  };
}

function resolveProjectReference(roots, item) {
  if (isAbsolute(item.path)) {
    throw new ProviderFault("invalid-checkpoint", "Checkpoint path must be project-relative.");
  }
  const pieces = item.path.replaceAll("\\", "/").split("/");
  if (pieces.some((piece) => !piece || piece === "." || piece === "..")) {
    throw new ProviderFault("invalid-checkpoint", "Checkpoint path contains traversal.");
  }
  let file;
  try {
    file = realpathSync(join(roots.projectRoot, ...pieces));
  } catch {
    throw new ProviderFault("checkpoint-source-unavailable", `Checkpoint source is unavailable: ${item.path}`);
  }
  if (!within(roots.vaultRoot, file) || !statSync(file).isFile()) {
    throw new ProviderFault("invalid-checkpoint", `Checkpoint source is outside MemoValeOS: ${item.path}`);
  }
  return file;
}

function verifyReference(roots, item) {
  const file = resolveProjectReference(roots, item);
  const actual = `sha256:${sha256(readFileSync(file))}`;
  if (actual !== item.digest) {
    throw new ProviderFault("checkpoint-digest-mismatch", `Checkpoint source changed: ${item.path}`);
  }
}

function checkpoint(request, roots, observedAt) {
  const { cycle_id: cycleId, envelope_id: envelopeId, references } = request.payload;
  if (typeof cycleId !== "string" || !cycleId || typeof envelopeId !== "string" || !envelopeId ||
      !Array.isArray(references) || !references.length) {
    throw new ProviderFault("invalid-checkpoint", "checkpoint requires cycle_id, envelope_id, and references.");
  }
  const minimal = references.map(minimalReference);
  for (const item of minimal) verifyReference(roots, item);
  const seed = JSON.stringify({ cycleId, envelopeId, minimal });
  return response(request, "ok", {
    checkpoint: {
      id: `memovale-checkpoint-${sha256(seed).slice(0, 20)}`,
      cycle_id: cycleId,
      envelope_id: envelopeId,
      reference_ids: minimal.map((item) => item.id),
      references: minimal,
      created_at: observedAt,
      storage: "reference-digest-only",
      protocol_version: PROTOCOL_VERSION,
    },
  });
}

function restore(request, roots) {
  const saved = requireObject(request.payload.checkpoint, "checkpoint");
  if (!Array.isArray(saved.references) || !Array.isArray(saved.reference_ids) ||
      saved.storage !== "reference-digest-only" || saved.protocol_version !== PROTOCOL_VERSION) {
    throw new ProviderFault("invalid-checkpoint", "Unsupported or incomplete MemoValeOS checkpoint.");
  }
  const minimal = saved.references.map(minimalReference);
  if (JSON.stringify(saved.reference_ids) !== JSON.stringify(minimal.map((item) => item.id))) {
    throw new ProviderFault("invalid-checkpoint", "Checkpoint reference identity is inconsistent.");
  }
  for (const item of minimal) verifyReference(roots, item);
  return response(request, "ok", {
    checkpoint_id: saved.id,
    envelope_id: saved.envelope_id,
    reference_ids: saved.reference_ids,
    restored: true,
  });
}

function validateCandidate(value) {
  const candidate = requireObject(value, "candidate");
  const allowed = new Set([
    "id", "kind", "title", "content", "source_reference_ids", "requires_human",
    "created_at", "evidence_level", "adapter_extensions", "protocol_version",
  ]);
  if (Object.keys(candidate).some((key) => !allowed.has(key)) ||
      [...allowed].some((key) => !Object.hasOwn(candidate, key))) {
    throw new ProviderFault("invalid-knowledge-candidate", "Knowledge candidate fields do not match protocol 1.0.");
  }
  if (typeof candidate.id !== "string" || !candidate.id ||
      !CANDIDATE_KINDS.has(candidate.kind) ||
      typeof candidate.title !== "string" || !candidate.title.trim() ||
      typeof candidate.content !== "string" || !candidate.content.trim() ||
      !Array.isArray(candidate.source_reference_ids) ||
      candidate.source_reference_ids.some((item) => typeof item !== "string" || !item) ||
      new Set(candidate.source_reference_ids).size !== candidate.source_reference_ids.length ||
      typeof candidate.requires_human !== "boolean" ||
      !EVIDENCE_LEVELS.has(candidate.evidence_level) ||
      candidate.protocol_version !== PROTOCOL_VERSION ||
      !candidate.adapter_extensions || typeof candidate.adapter_extensions !== "object" ||
      Array.isArray(candidate.adapter_extensions) ||
      Number.isNaN(Date.parse(candidate.created_at))) {
    throw new ProviderFault("invalid-knowledge-candidate", "Knowledge candidate is invalid.");
  }
  if (HUMAN_REVIEW_KINDS.includes(candidate.kind) && !candidate.requires_human) {
    throw new ProviderFault("invalid-knowledge-candidate", `${candidate.kind} candidates require human review.`);
  }
  const target = KIND_MAP[candidate.kind];
  if (candidate.evidence_level === "user-provided") {
    if ((EVIDENCE_ALTERNATIVES[target.type] ?? []).includes("user-provided")) return { candidate, target };
    throw new ProviderFault("insufficient-candidate-evidence", `user-provided evidence is accepted only for intent candidates, not ${candidate.kind}.`);
  }
  if (target.floor && !candidate.evidence_level) {
    throw new ProviderFault("insufficient-candidate-evidence", `${candidate.kind} candidate requires ${target.floor} evidence or better.`);
  }
  const order = ["L1", "L2", "L3", "L4"];
  if (target.floor && order.indexOf(candidate.evidence_level) < order.indexOf(target.floor)) {
    throw new ProviderFault("insufficient-candidate-evidence", `${candidate.kind} candidate requires ${target.floor} evidence or better.`);
  }
  return { candidate, target };
}

function markdownFiles(roots, root = roots.vaultRoot) {
  return walkFiles(roots, root).filter((item) => item.toLowerCase().endsWith(".md"));
}

function safeFilename(title) {
  const cleaned = title.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").replace(/\s+/g, " ").trim().replace(/[. ]+$/g, "");
  if (!cleaned || cleaned === "." || cleaned === "..") {
    throw new ProviderFault("invalid-knowledge-candidate", "Candidate title cannot form a safe note filename.");
  }
  // The vault's file names carry no spaces (a56b29a); a suggestion follows suit.
  return `${cleaned.replace(/ /g, "-")}.md`;
}

function proposeKnowledge(request, roots, observedAt) {
  const { candidate, target } = validateCandidate(request.payload.candidate);
  const normalizedTitle = candidate.title.trim().toLocaleLowerCase("en");
  const duplicates = [];
  for (const file of markdownFiles(roots)) {
    const raw = readFileSync(file, "utf8");
    const title = raw.match(/^#\s+(.+)$/m)?.[1]?.trim().toLocaleLowerCase("en");
    if (title === normalizedTitle) duplicates.push(posix(relative(roots.vaultRoot, file)));
  }
  /* A suggestion must never name a file that already exists: a reviewer who
   * accepts it as given would overwrite that note. */
  const filename = safeFilename(candidate.title);
  const stem = filename.replace(/\.md$/, "");
  let suggestedPath = `${target.folder}/${filename}`;
  for (let n = 2; existsSync(join(roots.vaultRoot, suggestedPath)); n++) {
    suggestedPath = `${target.folder}/${stem}-${n}.md`;
  }
  const date = observedAt.slice(0, 10);
  const frontmatterProposal = {
    type: target.type,
    lifecycle: target.lifecycle,
    ...(target.status ? { status: target.status } : {}),
    created: date,
    updated: date,
  };
  if (candidate.evidence_level) frontmatterProposal.evidence = candidate.evidence_level;
  return response(request, "ok", {
    proposal: {
      candidate_id: candidate.id,
      mapped_type: target.type,
      suggested_path: suggestedPath,
      duplicate_paths: stableSort(duplicates),
      frontmatter: frontmatterProposal,
      title: candidate.title.trim(),
      body: candidate.content,
      source_reference_ids: candidate.source_reference_ids,
      requires_human: true,
      write_performed: false,
      proposed_at: observedAt,
    },
  }, duplicates.length ? ["A note with the same heading already exists; review before promotion."] : []);
}

export async function handleRequest(input, options = {}) {
  const request = input && typeof input === "object" ? input : { request_id: "invalid-request" };
  try {
    validateRequest(request);
    const roots = resolveRoots(options);
    const observedAt = now(options);
    if (request.operation === "capabilities") return response(request, "ok", capabilitiesPayload());
    if (request.operation === "health") return response(request, "ok", health(roots));
    health(roots);
    if (request.operation === "prepare_context") return prepareContext(request, roots, observedAt);
    if (request.operation === "checkpoint") return checkpoint(request, roots, observedAt);
    if (request.operation === "restore") return restore(request, roots);
    if (request.operation === "propose_knowledge") return proposeKnowledge(request, roots, observedAt);
    throw new ProviderFault("unsupported-operation", `Unsupported operation: ${request.operation}`);
  } catch (error) {
    return errorResponse(request, error);
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--project-root", "--vault-root"].includes(flag) || index + 1 >= argv.length) {
      throw new ProviderFault("invalid-arguments", `Expected --project-root or --vault-root, got: ${flag}`);
    }
    const key = flag === "--project-root" ? "projectRoot" : "vaultRoot";
    options[key] = argv[index + 1];
    index += 1;
  }
  return options;
}

async function main() {
  let input;
  try {
    const bytes = readFileSync(0);
    if (bytes.length > MAX_REQUEST_BYTES) {
      throw new ProviderFault("request-too-large", "Provider request exceeds the 1 MiB process boundary.");
    }
    input = JSON.parse(bytes.toString("utf8"));
    const result = await handleRequest(input, parseArgs(process.argv.slice(2)));
    process.stdout.write(JSON.stringify(result));
  } catch (error) {
    process.stdout.write(JSON.stringify(errorResponse(input, error)));
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main();
}
