/**
 * os-manifest, read once.
 *
 * The manifest is the definition of the OS layer: what travels to upstream and
 * what upgrade.mjs may overwrite. More than one tool needs to ask "is this path
 * OS layer?" — delivery, and since os-v5 the git-based C3 count — and each copy
 * of the matcher is one more place for the answer to drift.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

/* One vault-relative path or glob per line. `*` stays within one segment, `**`
 * crosses segments, every other character is literal — the same reading as
 * `validate-vault.mjs`, which judges `os-layer-outside-manifest` by it. A `!`
 * line excludes, whatever its position in the file. */
export function compileManifest(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

  const toRegExp = (pattern) => {
    let out = "";
    for (let i = 0; i < pattern.length; i++) {
      const c = pattern[i];
      if (c === "*") {
        if (pattern[i + 1] === "*") {
          out += ".*";
          i++;
        } else out += "[^/]*";
      } else if (".+^${}()|[]\\?".includes(c)) out += "\\" + c;
      else out += c;
    }
    return new RegExp("^" + out + "$");
  };

  const include = lines.filter((l) => !l.startsWith("!")).map(toRegExp);
  const exclude = lines.filter((l) => l.startsWith("!")).map((l) => toRegExp(l.slice(1)));
  return (f) => include.some((r) => r.test(f)) && !exclude.some((r) => r.test(f));
}

/* The vault's own manifest as a predicate, or null when the vault has none. */
export function readManifest(vault) {
  const path = join(vault, "Knowledge-OS", "os-manifest");
  if (!existsSync(path)) return null;
  return compileManifest(readFileSync(path, "utf8"));
}

/* Files that are part of the system although no manifest line may name them:
 * every copy keeps its own, and a manifest line would let upgrade.mjs
 * overwrite a host project's README, Obsidian settings or OS backlog with this
 * project's. os-manifest's comment explains the exclusion; this is the list in
 * a form code can use — delivery carries them by hand, and work on them is
 * still work on the OS. */
export const PER_COPY_FILES = [
  "CLAUDE.md",
  "README.md",
  ".os-version",
  ".obsidian/app.json",
  ".obsidian/templates.json",
  "Backlog.md",
];

/* Before a56b29a (2026-09-17) every path in the vault could carry spaces —
 * `Knowledge OS/Context Index.md`. That commit replaced each space with a
 * hyphen, so the same mapping reads an old path in today's terms. */
export const currentPathName = (path) => path.replace(/ /g, "-");
