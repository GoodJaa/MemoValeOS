#!/usr/bin/env node
/**
 * Report the shape of the knowledge graph.
 *
 * `validate-vault.mjs` answers whether links are *correct*: every `[[target]]`
 * resolves (`broken-link`), no bare basename is ambiguous
 * (`ambiguous-basename-link`), every `field::` is a declared relationship type
 * (`unknown-relationship-field`), and nothing is unreferenced
 * (`orphaned-note`). All four are local: they check one note at a time.
 *
 * None of them answers whether the graph is *connected* — whether the notes
 * form one body of knowledge or several islands that each pass every local
 * check. A vault can be fully valid and still be four disconnected clusters,
 * and the reader who follows links from the entry point would never learn that
 * the other three exist.
 *
 * This tool answers the global questions instead:
 *
 *   - how many connected components are there (1 is the healthy answer);
 *   - how many notes are reachable by following links from an entry point;
 *   - which relationship types are actually in use, and how often;
 *   - how many edges are typed relationships versus bare prose links.
 *
 * It reports and never fails: this is a description of the graph, not a gate.
 * The gate is validate-vault.mjs, and the conditions worth failing on are
 * already rules there.
 *
 * Usage:
 *   node "Knowledge-OS/Tools/graph-report.mjs"
 *   node "Knowledge-OS/Tools/graph-report.mjs" --from "Knowledge-OS/README.md"
 *   node "Knowledge-OS/Tools/graph-report.mjs" --json
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, sep, dirname, relative, basename } from "node:path";
import { fileURLToPath } from "node:url";

const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const KNOWLEDGE_ROOTS = ["Knowledge-OS", "Project-OS"];
// Keep in step with NEVER_WALK in validate-vault.mjs: a fixture vault walked
// as if it were this one reports test data as the project's own knowledge.
const NEVER_WALK = ["node_modules", "dist", "build", ".next", "coverage", ".git", "__fixtures__", "__provider_fixtures__"];
const TEMPLATES = join("Project-OS", "Templates");

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const fromIdx = argv.indexOf("--from");
/* Home is where Project-OS routes from, but it is the project's note, not the
 * OS's: a vault without one starts from the Knowledge-OS README instead. */
const START =
  fromIdx !== -1
    ? argv[fromIdx + 1]
    : existsSync(join(VAULT, "Project-OS", "00-Home", "Home.md"))
      ? "Project-OS/00-Home/Home.md"
      : "Knowledge-OS/README.md";

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name.startsWith(".") || NEVER_WALK.includes(e.name)) continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const notes = new Map();
for (const file of walk(VAULT)) {
  const rel = relative(VAULT, file);
  if (!KNOWLEDGE_ROOTS.includes(rel.split(sep)[0])) continue;
  if (rel.startsWith(TEMPLATES + sep)) continue;
  // Dist/ holds command sources: instructions to the assistant, not notes.
  if (rel.startsWith(join("Knowledge-OS", "Dist") + sep)) continue;
  const posix = rel.split(sep).join("/");
  const raw = readFileSync(file, "utf8");
  // Links shown as code are examples, not edges (the validator strips them too).
  const text = raw.replace(/```[\s\S]*?```/g, "").replace(/`[^`\n]*`/g, "");
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw);
  notes.set(posix, {
    text,
    type: fm ? ((fm[1].match(/^type:\s*(\S+)/m) || [])[1] || "").toLowerCase() || undefined : undefined,
    base: basename(posix, ".md"),
  });
}

const byBasename = new Map();
for (const [rel, n] of notes) {
  if (!byBasename.has(n.base)) byBasename.set(n.base, []);
  byBasename.get(n.base).push(rel);
}

/* The same resolution validate-vault.mjs uses (`pathLinkCandidates`), which is
 * Obsidian's: a target with a path segment is an exact path, or else the files
 * whose path ends with it; a bare basename may match several. A path link
 * used to fall back to its last segment here, so `[[Wrong/Folder/Note]]` was
 * an edge in this report while the validator called it `broken-link`. */
function resolveTarget(target) {
  const norm = target.split("\\").join("/").replace(/\.md$/, "");
  if (norm.includes("/")) {
    const keys = [...notes.keys()];
    const exact = keys.filter((p) => p === norm + ".md" || p === norm);
    if (exact.length) return exact;
    return keys.filter((p) => p.endsWith("/" + norm + ".md"));
  }
  return byBasename.get(norm) || [];
}

const LINK = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const RELATIONSHIP = /^[ \t]*(?:[-*+][ \t]+)?([a-z-]+)::\s*(.+)$/gm;

const outgoing = new Map();
const incoming = new Map();
for (const rel of notes.keys()) {
  outgoing.set(rel, new Set());
  incoming.set(rel, new Set());
}

const typedCounts = new Map();
let typedEdges = 0;
let proseEdges = 0;

for (const [rel, n] of notes) {
  const claimedByRelationship = new Set();

  for (const m of n.text.matchAll(RELATIONSHIP)) {
    for (const raw of m[2].match(LINK) || []) claimedByRelationship.add(raw);
    for (const link of m[2].matchAll(LINK)) {
      for (const target of resolveTarget(link[1].trim())) {
        if (target === rel) continue;
        typedEdges++;
        typedCounts.set(m[1], (typedCounts.get(m[1]) || 0) + 1);
        outgoing.get(rel).add(target);
        incoming.get(target).add(rel);
      }
    }
  }

  for (const m of n.text.matchAll(LINK)) {
    if (claimedByRelationship.has(m[0])) continue;
    for (const target of resolveTarget(m[1].trim())) {
      if (target === rel) continue;
      if (!outgoing.get(rel).has(target)) proseEdges++;
      outgoing.get(rel).add(target);
      incoming.get(target).add(rel);
    }
  }
}

// Connected components, treating edges as undirected: two notes are in the
// same body of knowledge whichever way the link points.
const seen = new Set();
const components = [];
for (const rel of notes.keys()) {
  if (seen.has(rel)) continue;
  const stack = [rel];
  const component = [];
  seen.add(rel);
  while (stack.length) {
    const cur = stack.pop();
    component.push(cur);
    for (const nb of [...outgoing.get(cur), ...incoming.get(cur)]) {
      if (!seen.has(nb)) {
        seen.add(nb);
        stack.push(nb);
      }
    }
  }
  components.push(component);
}
components.sort((a, b) => b.length - a.length);

const isolated = [...notes.keys()].filter(
  (r) => outgoing.get(r).size === 0 && incoming.get(r).size === 0
);

// Reachability by actually following links forward, the way a reader does.
const reachable = new Set();
if (notes.has(START)) {
  reachable.add(START);
  const stack = [START];
  while (stack.length) {
    const cur = stack.pop();
    for (const nb of outgoing.get(cur) || []) {
      if (!reachable.has(nb)) {
        reachable.add(nb);
        stack.push(nb);
      }
    }
  }
}
const unreachable = [...notes.keys()].filter((r) => !reachable.has(r));

if (asJson) {
  console.log(
    JSON.stringify(
      {
        notes: notes.size,
        typedEdges,
        proseEdges,
        relationshipsInUse: Object.fromEntries(typedCounts),
        components: components.map((c) => c.length),
        isolated,
        start: START,
        reachable: reachable.size,
        unreachable,
      },
      null,
      2
    )
  );
  process.exit(0);
}

console.log(`Notes in the graph: ${notes.size}\n`);

console.log(`Edges: ${typedEdges} typed, ${proseEdges} prose-only`);
const total = typedEdges + proseEdges;
if (total) {
  console.log(`  ${Math.round((typedEdges / total) * 100)}% of edges declare a relationship type\n`);
}

console.log("Relationship types in use:");
if (typedCounts.size === 0) console.log("  none — every edge is a bare prose link");
for (const [kind, n] of [...typedCounts].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${kind.padEnd(16)} ${n}`);
}

console.log(`\nConnected components: ${components.length}`);
if (components.length === 1) {
  console.log("  one body of knowledge — nothing is an island");
} else {
  for (const c of components) {
    if (c.length > 5) console.log(`  ${String(c.length).padStart(4)} notes (main)`);
    else console.log(`  ${String(c.length).padStart(4)} notes: ${c.join(", ")}`);
  }
}

console.log(`\nIsolated notes (no link either way): ${isolated.length}`);
for (const r of isolated) console.log(`  ${r}`);

if (!notes.has(START)) {
  console.log(`\nEntry point \`${START}\` is not a note in this vault — pass --from.`);
} else {
  console.log(`\nReachable by following links from ${START}: ${reachable.size} of ${notes.size}`);
  if (unreachable.length) {
    const byType = {};
    for (const r of unreachable) {
      const t = notes.get(r).type || "(none)";
      byType[t] = (byType[t] || 0) + 1;
    }
    console.log(`  not reachable from here: ${unreachable.length} — ${JSON.stringify(byType)}`);
    console.log("  (a vault has more than one entry point; try --from \"Knowledge-OS/README.md\")");
    for (const r of unreachable.slice(0, 10)) console.log(`     ${r}`);
  }
}
