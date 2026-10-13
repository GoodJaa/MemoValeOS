import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { handleRequest } from "./context-provider.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "__provider_fixtures__", "basic");
const PROVIDER = join(HERE, "context-provider.mjs");
const NOW = "2026-09-12T10:00:00Z";

function request(operation, payload = {}, adapterExtensions = {}) {
  return {
    request_id: `request-${operation}`,
    provider_id: "memovale",
    operation,
    payload,
    adapter_extensions: adapterExtensions,
    message_type: "request",
    protocol_version: "1.0",
  };
}

function plan(overrides = {}) {
  return {
    id: "context-plan-task-alpha",
    task_id: "task-alpha",
    stage: "context_discovery",
    target_facts: ["applicable decisions"],
    provider_ids: ["memovale"],
    max_files: 3,
    max_bytes: 32_768,
    stop_condition: "the governing decision is known",
    protocol_version: "1.0",
    ...overrides,
  };
}

async function withFixture(run) {
  const projectRoot = mkdtempSync(join(tmpdir(), "memovale-provider-"));
  const vaultRoot = join(projectRoot, "MemoValeOS");
  cpSync(FIXTURE, vaultRoot, { recursive: true });
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: projectRoot });
    execFileSync("git", ["config", "user.name", "Fixture"], { cwd: projectRoot });
    execFileSync("git", ["add", "-A"], { cwd: projectRoot });
    execFileSync("git", ["commit", "--quiet", "-m", "fixture"], { cwd: projectRoot });
    return await run({ projectRoot, vaultRoot });
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

const options = ({ projectRoot, vaultRoot }) => ({
  projectRoot,
  vaultRoot,
  now: () => NOW,
});

test("capabilities advertise read-only retrieval and proposal-only knowledge updates", async () => {
  await withFixture(async (roots) => {
    const response = await handleRequest(request("capabilities"), options(roots));
    assert.equal(response.status, "ok");
    assert.deepEqual(response.payload.capabilities.write_modes, ["read_only", "propose"]);
    assert.equal(response.payload.capabilities.managed_write, false);
    assert.equal(response.payload.capabilities.obsidian_required, false);
    assert.ok(response.payload.capabilities.operations.includes("checkpoint"));
  });
});

test("health succeeds from the filesystem when Obsidian is closed", async () => {
  await withFixture(async (roots) => {
    const response = await handleRequest(request("health"), options(roots));
    assert.equal(response.status, "ok");
    assert.equal(response.payload.healthy, true);
    assert.equal(response.payload.obsidian_required, false);
    assert.equal(response.payload.vault_root, "MemoValeOS");
  });
});

test("prepare_context reads only mandatory files and explicit entry points within budget", async () => {
  await withFixture(async (roots) => {
    const response = await handleRequest(
      request("prepare_context", {
        plan: plan(),
        entrypoints: ["Project-OS/05-Decisions/Decisions.md"],
      }),
      options(roots)
    );
    assert.equal(response.status, "ok");
    const paths = response.payload.references.map((item) => item.path);
    assert.deepEqual(paths, [
      "MemoValeOS/CLAUDE.md",
      "MemoValeOS/Knowledge-OS/Protocols/Context-Selection-Protocol.md",
      "MemoValeOS/Project-OS/05-Decisions/Decisions.md",
    ]);
    assert.ok(paths.every((item) => !item.includes("Do Not Load")));
    assert.ok(response.payload.references.every((item) => /^sha256:[0-9a-f]{64}$/.test(item.digest)));
    assert.ok(response.payload.references.every((item) => /^[0-9a-f]{40}$/.test(item.revision)));
    assert.equal(response.payload.receipt.adapter_extensions.selected_files, 3);
    assert.equal(response.payload.receipt.truncated, false);
    const decision = response.payload.receipt.adapter_extensions.sources.find(
      (item) => item.path.endsWith("Decisions.md")
    );
    assert.deepEqual(
      {
        type: decision.type,
        lifecycle: decision.lifecycle,
        evidence: decision.evidence,
        stale: decision.stale,
        updated: decision.updated,
      },
      { type: "decision", lifecycle: "active", evidence: "L2", stale: false, updated: "2026-09-11" }
    );
  });
});

test("prepare_context reports budget omissions instead of silently widening retrieval", async () => {
  await withFixture(async (roots) => {
    const response = await handleRequest(
      request("prepare_context", {
        plan: plan({ max_files: 2 }),
        entrypoints: ["Project-OS/05-Decisions/Decisions.md"],
      }),
      options(roots)
    );
    assert.equal(response.status, "degraded");
    assert.equal(response.payload.receipt.truncated, true);
    assert.deepEqual(response.payload.receipt.reference_ids.length, 2);
    assert.ok(response.payload.receipt.omissions.some((item) => item.includes("Decisions.md")));
  });
});

test("prepare_context flags stale and draft notes and omits superseded knowledge", async () => {
  await withFixture(async (roots) => {
    const response = await handleRequest(
      request("prepare_context", {
        plan: plan({ max_files: 5 }),
        entrypoints: [
          "Project-OS/04-Research/Draft-Note.md",
          "Project-OS/04-Research/Superseded-Note.md",
          "Project-OS/99-Unrelated/Do-Not-Load.md",
        ],
      }),
      options(roots)
    );
    assert.equal(response.status, "degraded");
    const sources = response.payload.receipt.adapter_extensions;
    assert.deepEqual(sources.draft_sources, ["Project-OS/04-Research/Draft-Note.md"]);
    assert.deepEqual(sources.stale_sources, ["Project-OS/99-Unrelated/Do-Not-Load.md"]);
    assert.ok(sources.lifecycle_omissions.some((item) => item.includes("Superseded-Note.md")));
    assert.ok(response.payload.references.every((item) => !item.path.includes("Superseded-Note.md")));
    assert.equal(response.payload.receipt.truncated, false);
  });
});

test("prepare_context selection identities are deterministic", async () => {
  await withFixture(async (roots) => {
    const payload = {
      plan: plan(),
      entrypoints: ["Project-OS/05-Decisions/Decisions.md"],
    };
    const first = await handleRequest(request("prepare_context", payload), options(roots));
    const secondRequest = request("prepare_context", payload);
    secondRequest.request_id = "request-prepare-context-repeat";
    const second = await handleRequest(secondRequest, options(roots));
    assert.deepEqual(second.payload.references, first.payload.references);
    assert.deepEqual(
      second.payload.receipt.adapter_extensions.sources,
      first.payload.receipt.adapter_extensions.sources
    );
  });
});

test("prepare_context never returns documentation written for people", async () => {
  await withFixture(async (roots) => {
    const response = await handleRequest(
      request("prepare_context", {
        plan: plan({ max_files: 5 }),
        entrypoints: ["Docs", "Docs/Provider-Docs-Page.md"],
      }),
      options(roots)
    );
    const paths = response.payload.references.map((item) => item.path);
    assert.ok(paths.every((item) => !item.includes("/Docs/")), `Docs leaked: ${paths.join(", ")}`);
    assert.deepEqual(paths, [
      "MemoValeOS/CLAUDE.md",
      "MemoValeOS/Knowledge-OS/Protocols/Context-Selection-Protocol.md",
    ]);
  });
});

test("entry points cannot escape the authorized vault", async () => {
  await withFixture(async (roots) => {
    const response = await handleRequest(
      request("prepare_context", { plan: plan(), entrypoints: ["../outside.md"] }),
      options(roots)
    );
    assert.equal(response.status, "error");
    assert.equal(response.errors[0].code, "invalid-entrypoint");
  });
});

test("checkpoint and restore persist references and digests but no note content", async () => {
  await withFixture(async (roots) => {
    const prepared = await handleRequest(
      request("prepare_context", {
        plan: plan(),
        entrypoints: ["Project-OS/05-Decisions/Decisions.md"],
      }),
      options(roots)
    );
    const checkpointed = await handleRequest(
      request("checkpoint", {
        cycle_id: "cycle-alpha",
        envelope_id: "envelope-alpha",
        references: prepared.payload.references,
      }),
      options(roots)
    );
    assert.equal(checkpointed.status, "ok");
    const serialized = JSON.stringify(checkpointed.payload);
    assert.ok(!serialized.includes("Use a read-only context provider"));
    assert.ok(!Object.hasOwn(checkpointed.payload.checkpoint.references[0], "content"));

    const restored = await handleRequest(
      request("restore", { checkpoint: checkpointed.payload.checkpoint }),
      options(roots)
    );
    assert.equal(restored.status, "ok");
    assert.deepEqual(restored.payload.reference_ids, prepared.payload.receipt.reference_ids);
  });
});

test("restore rejects changed source content", async () => {
  await withFixture(async (roots) => {
    const prepared = await handleRequest(
      request("prepare_context", {
        plan: plan(),
        entrypoints: ["Project-OS/05-Decisions/Decisions.md"],
      }),
      options(roots)
    );
    const checkpointed = await handleRequest(
      request("checkpoint", {
        cycle_id: "cycle-alpha",
        envelope_id: "envelope-alpha",
        references: prepared.payload.references,
      }),
      options(roots)
    );
    writeFileSync(join(roots.vaultRoot, "CLAUDE.md"), "changed\n");
    const restored = await handleRequest(
      request("restore", { checkpoint: checkpointed.payload.checkpoint }),
      options(roots)
    );
    assert.equal(restored.status, "error");
    assert.equal(restored.errors[0].code, "checkpoint-digest-mismatch");
  });
});

test("propose_knowledge validates, detects duplicates, maps type, and never writes", async () => {
  await withFixture(async (roots) => {
    const before = readFileSync(join(roots.vaultRoot, "Project-OS/05-Decisions/Decisions.md"), "utf8");
    const candidate = {
      id: "candidate-decision-alpha",
      kind: "decision",
      title: "Decisions",
      content: "Retain the provider boundary.",
      source_reference_ids: ["source-alpha"],
      requires_human: true,
      created_at: NOW,
      evidence_level: "L2",
      adapter_extensions: {},
      protocol_version: "1.0",
    };
    const response = await handleRequest(
      request("propose_knowledge", { candidate }, { write_mode: "propose" }),
      options(roots)
    );
    assert.equal(response.status, "ok");
    assert.equal(response.payload.proposal.mapped_type, "decision");
    assert.equal(response.payload.proposal.frontmatter.lifecycle, "draft");
    assert.equal(response.payload.proposal.frontmatter.status, "proposed");
    assert.deepEqual(response.payload.proposal.duplicate_paths, ["Project-OS/05-Decisions/Decisions.md"]);
    // The title collides with an existing note; the suggestion must not name it.
    assert.equal(response.payload.proposal.suggested_path, "Project-OS/05-Decisions/Decisions-2.md");
    assert.equal(response.payload.proposal.write_performed, false);
    assert.equal(
      readFileSync(join(roots.vaultRoot, "Project-OS/05-Decisions/Decisions.md"), "utf8"),
      before
    );
    assert.equal(
      execFileSync("git", ["status", "--porcelain"], { cwd: roots.projectRoot, encoding: "utf8" }),
      ""
    );
  });
});

function candidate(overrides = {}) {
  return {
    id: "candidate-alpha",
    kind: "finding",
    title: "Provider boundary holds",
    content: "Observed.",
    source_reference_ids: [],
    requires_human: false,
    created_at: NOW,
    evidence_level: "L1",
    adapter_extensions: {},
    protocol_version: "1.0",
    ...overrides,
  };
}

test("propose_knowledge requires human review for rule and intent candidates", async () => {
  await withFixture(async (roots) => {
    for (const kind of ["rule", "intent"]) {
      const response = await handleRequest(
        request("propose_knowledge", { candidate: candidate({ kind, evidence_level: "L4" }) }, { write_mode: "propose" }),
        options(roots)
      );
      assert.equal(response.status, "error", kind);
      assert.equal(response.errors[0].code, "invalid-knowledge-candidate", kind);
    }
  });
});

test("propose_knowledge accepts user-provided for intent only", async () => {
  await withFixture(async (roots) => {
    const intent = await handleRequest(
      request("propose_knowledge", { candidate: candidate({ kind: "intent", requires_human: true, evidence_level: "user-provided" }) }, { write_mode: "propose" }),
      options(roots)
    );
    assert.equal(intent.status, "ok");
    assert.equal(intent.payload.proposal.frontmatter.evidence, "user-provided");
    assert.equal(intent.payload.proposal.suggested_path, "Project-OS/01-Product/Provider-boundary-holds.md");
    const finding = await handleRequest(
      request("propose_knowledge", { candidate: candidate({ evidence_level: "user-provided" }) }, { write_mode: "propose" }),
      options(roots)
    );
    assert.equal(finding.status, "error");
    assert.equal(finding.errors[0].code, "insufficient-candidate-evidence");
  });
});

test("superseded knowledge does not spend the budget or truncate the selection", async () => {
  await withFixture(async (roots) => {
    // Exactly enough bytes for the mandatory files and the Decision, so the
    // superseded note would overflow the budget if it were counted against it.
    const size = (p) => readFileSync(join(roots.vaultRoot, p)).length;
    const exact = size("CLAUDE.md") + size("Knowledge-OS/Protocols/Context-Selection-Protocol.md") + size("Project-OS/05-Decisions/Decisions.md");
    const response = await handleRequest(
      request("prepare_context", {
        plan: plan({ max_files: 3, max_bytes: exact }),
        entrypoints: ["Project-OS/04-Research/Superseded-Note.md", "Project-OS/05-Decisions/Decisions.md"],
      }),
      options(roots)
    );
    assert.equal(response.payload.receipt.truncated, false);
    assert.ok(response.payload.references.some((item) => item.path.endsWith("Decisions.md")));
  });
});

test("managed-write requests fail closed", async () => {
  await withFixture(async (roots) => {
    const response = await handleRequest(
      request("propose_knowledge", {}, { write_mode: "managed_write" }),
      options(roots)
    );
    assert.equal(response.status, "error");
    assert.equal(response.errors[0].code, "managed-write-forbidden");
  });
});

test("CLI speaks one UTF-8 JSON request/response without Obsidian", async () => {
  await withFixture(async ({ projectRoot, vaultRoot }) => {
    const input = JSON.stringify(request("health"));
    const stdout = execFileSync(
      "node",
      [PROVIDER, "--project-root", projectRoot, "--vault-root", vaultRoot],
      { input, encoding: "utf8", env: { ...process.env, OBSIDIAN_API_KEY: "" } }
    );
    const response = JSON.parse(stdout);
    assert.equal(response.status, "ok");
    assert.equal(response.payload.obsidian_required, false);
  });
});
