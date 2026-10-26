#!/usr/bin/env node
/**
 * os-patch.mjs — the OS layer's changes since the last delivery, as a patch
 * that carries no history.
 *
 * Until os-v5 delivery went by `git subtree split --prefix=<vault>`: upstream
 * merged a branch whose history was this project's whole vault directory. The
 * files that did not belong were put back afterwards (sync-upstream.mjs), but
 * the commits stayed — every Task, Finding, Decision and plan of the project
 * that develops the OS, published in upstream's history with each sync. A
 * public distribution repository is the wrong place for a private project's
 * knowledge, and a filter applied after the merge cannot remove a commit.
 *
 * So nothing is merged any more. This writes `git diff <since> <to>` limited to
 * the paths os-manifest names, relative to the vault root, with full blob ids
 * so that upstream can apply it three-way:
 *
 *   in this project:  node "Knowledge-OS/Tools/os-patch.mjs" --since os-v5 --out os.patch
 *   in upstream:      git apply --3way --index os.patch
 *
 * `<since>` is the tag of the previous delivery, set on this project's commit
 * whose OS layer was delivered. A path counts if either side's manifest names
 * it: a file renamed out of the OS layer must still be deleted upstream, and
 * the manifest that named it is the old one. Renames travel as a delete and an
 * add (`--no-renames`), which `git apply` cannot misread. Only committed work
 * travels; the working tree is not read.
 *
 * A copy with no tag to start from — installed from upstream, its vault
 * excluded from the project's git or its `.git` deleted, as on the first real
 * installation — delivers with `--against` instead:
 *
 *   in the copy:      node "Knowledge-OS/Tools/os-patch.mjs" --against <upstream clone> [--base <ref>] --out os.patch
 *
 * The base is upstream at the version the copy was installed or upgraded to
 * (`.os-version`, or `--base`), and the patch is that base against the copy's
 * files on disk. Not upstream's HEAD: a copy at os-v6 diffed against an os-v7
 * upstream would carry back everything os-v7 changed, undone. Built in a
 * throwaway repository from upstream's own blobs, so its preimage ids exist in
 * upstream and `git apply --3way` merges it with what upstream did since.
 * Text read from disk is taken with LF, as upstream stores it; a `.mvos-new`
 * left by an upgrade conflict never travels.
 *
 * Usage:
 *   node "Knowledge-OS/Tools/os-patch.mjs" --since <ref> [--to <ref>] [--out <file>]
 *   node "Knowledge-OS/Tools/os-patch.mjs" --against <upstream clone> [--base <ref>] [--out <file>]
 *
 * The list of paths goes to stderr, the patch to stdout or --out. Exit codes:
 * 0 done (an empty patch when nothing in the OS layer changed), 1 a
 * precondition failed.
 */
import { writeFileSync, realpathSync, readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { dirname, relative, sep, join, resolve as resolvePath } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { compileManifest } from "./manifest.mjs";

/* ------------------------------------------------------------ pure parts */

/* `git diff --name-status -z --no-renames`: `<status>\0<path>\0` pairs. */
export function parseNameStatusZ(raw) {
  const fields = raw.split("\0").filter(Boolean);
  const entries = [];
  for (let i = 0; i + 1 < fields.length; i += 2) entries.push({ status: fields[i], path: fields[i + 1] });
  return entries;
}

/* The changed paths that are OS layer on either side. `toVault` maps a
 * repository path to a vault-relative one, or null outside the vault. */
export function selectOsPaths(entries, toVault, manifests) {
  return entries.filter(({ path }) => {
    const v = toVault(path);
    return v !== null && manifests.some((inManifest) => inManifest(v));
  });
}

/* Text from disk compared and delivered the way upstream stores it: a checkout
 * with autocrlf has CRLF on disk and LF in the repository. Binary content, and
 * a file the base itself stores with CRLF, are left exactly as they are. */
export function asStored(content, base) {
  if (content.includes(0) || (base && base.includes("\r\n"))) return content;
  return Buffer.from(content.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
}

/* ------------------------------------------------------------------- run */

const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function writePatch(patch, out) {
  if (out) {
    writeFileSync(out, patch);
    console.error(`Wrote ${out}. In upstream: git apply --3way --index <path to it>`);
  } else {
    process.stdout.write(patch);
  }
}

/* Every file under the vault on disk, vault-relative with `/`. */
function filesOnDisk(dir, base = dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === ".git" || e.name === "node_modules" || e.name === ".mvos") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) filesOnDisk(p, base, out);
    else if (e.isFile()) out.push(relative(base, p).split(sep).join("/"));
  }
  return out;
}

function patchAgainst(upstreamDir, baseArg, out) {
  const up = resolvePath(upstreamDir);
  const git = (cwd, args, encoding = "utf8") =>
    execFileSync("git", args, { cwd, encoding, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 512 * 1024 * 1024 });

  const versionFile = join(VAULT, ".os-version");
  const base = baseArg || (existsSync(versionFile) ? readFileSync(versionFile, "utf8").trim() : "");
  if (!base) {
    console.error("This copy has no .os-version. Name the upstream version it was installed from: --base os-vN.");
    process.exit(1);
  }
  let baseCommit;
  try {
    baseCommit = git(up, ["rev-parse", "--verify", "--quiet", `${base}^{commit}`]).trim();
  } catch {
    console.error(`\`${base}\` does not name a commit in ${up}. Fetch upstream's tags (git fetch --tags) or name the base with --base.`);
    process.exit(1);
  }

  let baseManifest;
  try {
    baseManifest = compileManifest(git(up, ["show", `${baseCommit}:Knowledge-OS/os-manifest`]));
  } catch {
    console.error(`${up} at \`${base}\` has no Knowledge-OS/os-manifest at its root — is it a clone of the distribution repository?`);
    process.exit(1);
  }
  const ourManifestPath = join(VAULT, "Knowledge-OS", "os-manifest");
  const manifests = [baseManifest, ...(existsSync(ourManifestPath) ? [compileManifest(readFileSync(ourManifestPath, "utf8"))] : [])];
  const inLayer = (p) => !p.endsWith(".mvos-new") && manifests.some((m) => m(p));

  const baseFiles = new Set(git(up, ["ls-tree", "-r", "-z", "--name-only", baseCommit]).split("\0").filter(Boolean).filter(inLayer));
  const ourFiles = new Set(filesOnDisk(VAULT).filter(inLayer));

  const changed = [];
  for (const p of [...new Set([...baseFiles, ...ourFiles])].sort()) {
    const before = baseFiles.has(p) ? git(up, ["show", `${baseCommit}:${p}`], "buffer") : null;
    const after = ourFiles.has(p) ? asStored(readFileSync(join(VAULT, ...p.split("/"))), before) : null;
    if (before && after && before.equals(after)) continue;
    changed.push({ path: p, before, after, status: !before ? "A" : !after ? "D" : "M" });
  }

  console.error(`OS layer ${base} (${baseCommit.slice(0, 7)}, in ${up}) → this copy on disk: ${changed.length} path(s)`);
  for (const { status, path } of changed) console.error(`  ${status}  ${path}`);

  /* The two sides as two commits of a throwaway repository: upstream's blobs
   * byte for byte, then the copy's files. */
  const tmp = mkdtempSync(join(tmpdir(), "mv-os-patch-"));
  try {
    const t = (args, encoding) => git(tmp, args, encoding);
    t(["init", "--quiet"]);
    for (const [k, v] of [["user.email", "os-patch@example.invalid"], ["user.name", "os-patch"], ["commit.gpgsign", "false"], ["core.autocrlf", "false"]]) t(["config", k, v]);
    const put = (p, content) => {
      const file = join(tmp, ...p.split("/"));
      if (content === null) return rmSync(file, { force: true });
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, content);
    };
    for (const c of changed) if (c.before) put(c.path, c.before);
    t(["add", "-A"]);
    t(["commit", "--quiet", "--allow-empty", "-m", "base"]);
    for (const c of changed) put(c.path, c.after);
    t(["add", "-A"]);
    t(["commit", "--quiet", "--allow-empty", "-m", "copy"]);
    writePatch(t(["diff", "--binary", "--full-index", "--no-renames", "HEAD~1", "HEAD"], "buffer"), out);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main() {
  const argv = process.argv.slice(2);
  const value = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
  };
  const since = value("--since");
  const to = value("--to") || "HEAD";
  const out = value("--out");
  const against = value("--against");
  if (against) return patchAgainst(against, value("--base"), out);
  if (!since) {
    console.error("Usage: os-patch.mjs --since <ref> [--to <ref>] [--out <file>]");
    console.error("       os-patch.mjs --against <upstream clone> [--base <ref>] [--out <file>]");
    console.error("<ref> is the tag of the previous delivery (os-vN). A copy without one delivers --against an upstream clone.");
    process.exit(1);
  }

  const git = (args, encoding = "utf8") =>
    execFileSync("git", args, { cwd: repoRoot ?? VAULT, encoding, stdio: ["ignore", "pipe", "pipe"], maxBuffer: 512 * 1024 * 1024 });
  let repoRoot = null;
  try {
    repoRoot = git(["rev-parse", "--show-toplevel"]).trim();
  } catch {
    console.error("The vault is not inside a git repository.");
    process.exit(1);
  }
  const vaultPrefix = relative(repoRoot, VAULT).split(sep).join("/");
  const inVault = (p) => (vaultPrefix ? `${vaultPrefix}/${p}` : p);
  const toVault = (p) => (!vaultPrefix ? p : p.startsWith(vaultPrefix + "/") ? p.slice(vaultPrefix.length + 1) : null);

  const resolve = (ref) => {
    try {
      return git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]).trim();
    } catch {
      console.error(`\`${ref}\` does not name a commit here. Tag the previous delivery first (git tag os-vN <commit>).`);
      process.exit(1);
    }
  };
  const fromCommit = resolve(since);
  const toCommit = resolve(to);

  const manifestAt = (commit) => {
    try {
      return compileManifest(git(["show", `${commit}:${inVault("Knowledge-OS/os-manifest")}`]));
    } catch {
      return null;
    }
  };
  const manifests = [manifestAt(fromCommit), manifestAt(toCommit)].filter(Boolean);
  if (!manifests.length) {
    console.error("Neither side has Knowledge-OS/os-manifest — cannot tell the OS layer from the project's own knowledge.");
    process.exit(1);
  }

  const changed = parseNameStatusZ(
    git(["diff", "--name-status", "-z", "--no-renames", fromCommit, toCommit, "--", vaultPrefix || "."])
  );
  const selected = selectOsPaths(changed, toVault, manifests);

  console.error(`OS layer ${since} (${fromCommit.slice(0, 7)}) → ${to} (${toCommit.slice(0, 7)}): ${selected.length} path(s)`);
  for (const { status, path } of selected) console.error(`  ${status}  ${toVault(path)}`);

  /* In batches: a long release touches hundreds of paths, and one command
   * line holding them all can exceed what Windows passes to a process. */
  const chunks = [];
  for (let i = 0; i < selected.length; i += 100) {
    const paths = selected.slice(i, i + 100).map((e) => `:(literal)${e.path}`);
    const args = ["diff", "--binary", "--full-index", "--no-renames"];
    if (vaultPrefix) args.push(`--relative=${vaultPrefix}/`);
    chunks.push(git([...args, fromCommit, toCommit, "--", ...paths], "buffer"));
  }
  writePatch(Buffer.concat(chunks), out);
}

/* Run only when invoked directly, so the test can import the pure parts. */
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
