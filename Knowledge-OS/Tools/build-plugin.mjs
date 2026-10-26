#!/usr/bin/env node
/**
 * build-plugin.mjs — build the Claude Code plugin `mv` from the command
 * sources in Knowledge-OS/Dist/commands/.
 *
 * The personal install (`adopt.mjs --local`) does not copy commands into a
 * host's `.claude/`; it installs this plugin, from a marketplace that is the
 * vault itself (`.claude-plugin/marketplace.json` at the vault root). Copying
 * is what made the personal install touch a host's files, and two copies of a
 * command are what `deployed-command-drift` exists to police.
 *
 * So the plugin holds no command text. Each of its commands is a short wrapper
 * that finds this project's vault and follows the real command,
 * `Knowledge-OS/Dist/commands/mv-<name>.md`, read from there. A change to a
 * command reaches every plugin installation the moment the vault has it, with
 * no plugin update. What the plugin does copy — each command's description,
 * argument hint and allowed tools, which Claude Code reads before any text
 * is — is generated here, and `--check` fails when it is out of date; a test
 * runs `--check`, so a command source edited without a rebuild fails
 * `npm test`.
 *
 * Names: a plugin's commands are namespaced by the plugin, and the spike of
 * 2026-10-25 found the bare names unavailable. `mv-check.md` therefore becomes
 * the plugin command `check`, invoked as `/mv:check` — the owner's choice of
 * name. A team install copies the same sources and keeps `/mv-check`.
 *
 * The hook is not generated: `Dist/plugin/hooks/budget-audit-runner.cjs` is
 * hand-written. It finds the vault and runs the vault's own
 * `Dist/hooks/budget-audit.cjs`, so the hook has one source too.
 *
 * Usage:
 *   node "Knowledge-OS/Tools/build-plugin.mjs"           # write the plugin files
 *   node "Knowledge-OS/Tools/build-plugin.mjs" --check   # exit 1 if any is out of date
 *
 * Exit codes: 0 written, or up to date; 1 --check found a difference.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const VAULT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export const PLUGIN_NAME = "mv";
export const MARKETPLACE_NAME = "memovaleos";
const PLUGIN_SOURCE = "./Knowledge-OS/Dist/plugin";

const json = (o) => JSON.stringify(o, null, 2) + "\n";
const field = (fm, key) => {
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.+?)[ \\t]*$`, "m"));
  return m ? m[1] : null;
};

/** One wrapper command for one source command. */
export function wrapper(sourceName, source) {
  const fm = (source.replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---/) || [, ""])[1];
  const name = sourceName.replace(/^mv-/, "").replace(/\.md$/, "");
  const description = field(fm, "description") || `MemoValeOS /mv-${name}`;
  const hint = field(fm, "argument-hint");
  const tools = (field(fm, "allowed-tools") || "").split(",").map((t) => t.trim()).filter(Boolean);
  /* Finding and reading the source needs these two whatever the command
   * itself needs; the source's own allowed-tools apply to nothing once it is
   * read as a file, so they are carried over here. */
  for (const t of ["Glob", "Read"]) if (!tools.includes(t)) tools.unshift(t);
  return [
    "---",
    `description: ${description}`,
    ...(hint ? [`argument-hint: ${hint}`] : []),
    `allowed-tools: ${tools.join(", ")}`,
    "---",
    "",
    `<!-- Built by Knowledge-OS/Tools/build-plugin.mjs from Knowledge-OS/Dist/commands/${sourceName}. Edit the source, then rebuild. -->`,
    "",
    "This command's text lives in this project's MemoValeOS vault, not in the plugin, so the two cannot disagree.",
    "",
    `1. Find the vault: the project root \`\${CLAUDE_PROJECT_DIR}\` itself, or one of its direct subfolders, whichever holds both \`Knowledge-OS/\` and \`Project-OS/\`. Try \`\${CLAUDE_PROJECT_DIR}/MemoValeOS/\` first; otherwise Glob \`*/Knowledge-OS/Dist/commands/${sourceName}\` and \`Knowledge-OS/Dist/commands/${sourceName}\` from the project root. If there is no vault, say so and stop.`,
    `2. Read \`<vault>/Knowledge-OS/Dist/commands/${sourceName}\` and follow it exactly as the command \`/${PLUGIN_NAME}:${name}\`, with these arguments: $ARGUMENTS`,
    `   The text calls itself \`/mv-${name}\` and names its siblings \`/mv-…\`: in this plugin \`/mv-x\` is \`/${PLUGIN_NAME}:x\`.`,
    "",
  ].join("\n");
}

/** Every file the plugin consists of that this tool owns: path → content. */
export function pluginFiles(vault = VAULT) {
  const sources = readdirSync(join(vault, "Knowledge-OS", "Dist", "commands"))
    .filter((n) => /^mv-.+\.md$/.test(n))
    .sort();
  const files = new Map();
  files.set(
    ".claude-plugin/marketplace.json",
    json({
      name: MARKETPLACE_NAME,
      owner: { name: "MemoValeOS" },
      description: "MemoValeOS — a knowledge OS for projects worked on with an AI assistant. This vault is the marketplace.",
      plugins: [
        {
          name: PLUGIN_NAME,
          source: PLUGIN_SOURCE,
          description: "MemoValeOS commands (/mv:check, /mv:resume, /mv:close…) and the reading-budget hook, run from this project's vault",
        },
      ],
    })
  );
  files.set(
    "Knowledge-OS/Dist/plugin/.claude-plugin/plugin.json",
    json({
      name: PLUGIN_NAME,
      version: "1.0.0",
      description:
        "MemoValeOS commands and the reading-budget hook. The commands' text is read from the project's vault (Knowledge-OS/Dist/commands/), so plugin and vault cannot disagree.",
      author: { name: "MemoValeOS" },
      license: "MIT",
    })
  );
  files.set(
    "Knowledge-OS/Dist/plugin/hooks/hooks.json",
    json({
      hooks: {
        PreToolUse: [
          {
            matcher: "Read|Grep|Glob",
            hooks: [
              {
                type: "command",
                command: "node",
                args: ["${CLAUDE_PLUGIN_ROOT}/hooks/budget-audit-runner.cjs"],
                timeout: 10,
              },
            ],
          },
        ],
      },
    })
  );
  for (const s of sources) {
    const src = readFileSync(join(vault, "Knowledge-OS", "Dist", "commands", s), "utf8");
    files.set(`Knowledge-OS/Dist/plugin/commands/${s.replace(/^mv-/, "")}`, wrapper(s, src));
  }
  return files;
}

/** Generated command files present on disk that no source produces any more. */
function strayCommands(vault, files) {
  const dir = join(vault, "Knowledge-OS", "Dist", "plugin", "commands");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((n) => `Knowledge-OS/Dist/plugin/commands/${n}`)
    .filter((p) => !files.has(p));
}

function main() {
  const check = process.argv.includes("--check");
  const files = pluginFiles();
  const stale = [];
  for (const [rel, content] of files) {
    const p = join(VAULT, ...rel.split("/"));
    const have = existsSync(p) ? readFileSync(p, "utf8").replace(/\r\n/g, "\n") : null;
    if (have === content) continue;
    stale.push(rel);
    if (!check) {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content, "utf8");
    }
  }
  const strays = strayCommands(VAULT, files);
  if (!check) for (const rel of strays) rmSync(join(VAULT, ...rel.split("/")));

  if (check) {
    if (stale.length || strays.length) {
      console.log("The plugin is out of date with Knowledge-OS/Dist/commands/:");
      for (const rel of stale) console.log(`  ${rel}`);
      for (const rel of strays) console.log(`  ${rel}  (no source any more)`);
      console.log('Rebuild: node "Knowledge-OS/Tools/build-plugin.mjs"');
      process.exit(1);
    }
    console.log(`OK — the plugin matches its ${files.size - 3} command source(s).`);
    process.exit(0);
  }
  console.log(stale.length || strays.length ? `Wrote ${stale.length} file(s), removed ${strays.length}.` : "Up to date; nothing written.");
  for (const rel of [...stale, ...strays]) console.log(`  ${relative(VAULT, join(VAULT, rel)).split(sep).join("/")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
