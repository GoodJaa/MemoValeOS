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
 * Usage:
 *   node "Knowledge-OS/Tools/os-patch.mjs" --since <ref> [--to <ref>] [--out <file>]
 *
 * The list of paths goes to stderr, the patch to stdout or --out. Exit codes:
 * 0 done (an empty patch when nothing in the OS layer changed), 1 a
 * precondition failed.
 */
import { writeFileSync, realpathSync } from "node:fs";
import { dirname, relative, sep } from "node:path";
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

/* ------------------------------------------------------------------- run */

function main() {
  const argv = process.argv.slice(2);
  const value = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : null;
  };
  const since = value("--since");
  const to = value("--to") || "HEAD";
  const out = value("--out");
  if (!since) {
    console.error("Usage: os-patch.mjs --since <ref> [--to <ref>] [--out <file>]");
    console.error("<ref> is the tag of the previous delivery (os-vN).");
    process.exit(1);
  }

  const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
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
  const patch = Buffer.concat(chunks);
  if (out) {
    writeFileSync(out, patch);
    console.error(`Wrote ${out}. In upstream: git apply --3way --index <path to it>`);
  } else {
    process.stdout.write(patch);
  }
}

/* Run only when invoked directly, so the test can import the pure parts. */
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main();
}
