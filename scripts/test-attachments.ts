import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "mission-control-attachments-"));
delete process.env.DATABASE_URL;
process.env.ATTACHMENT_DATA_DIR = root;

const { promptWithAttachments, resolveAttachments, storeAttachments } = await import("../src/lib/attachments/store");

test.after(async () => { await rm(root, { recursive: true, force: true }); });

test("attachments are scoped, persisted, and rendered into an agent prompt", async () => {
  const stored = await storeAttachments({
    agentId: "hermes",
    sessionId: "operator-default",
    files: [new File(["sandbox evidence"], "evidence.txt", { type: "text/plain" })],
  });
  assert.equal(stored.length, 1);
  assert.equal(stored[0].name, "evidence.txt");

  const resolved = await resolveAttachments({
    agentId: "hermes",
    sessionId: "operator-default",
    ids: [stored[0].id],
  });
  assert.equal(resolved[0].storagePath, stored[0].storagePath);
  assert.match(promptWithAttachments("Inspect this", resolved), /evidence\.txt/);

  await assert.rejects(
    resolveAttachments({ agentId: "hermes", sessionId: "another-session", ids: [stored[0].id] }),
    /missing or outside/
  );
});

test("unsupported executable attachments are rejected", async () => {
  await assert.rejects(
    storeAttachments({
      agentId: "hermes",
      sessionId: "operator-default",
      files: [new File(["binary"], "payload.exe", { type: "application/octet-stream" })],
    }),
    /unsupported attachment type/
  );
});
