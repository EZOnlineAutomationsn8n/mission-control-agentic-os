import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const root = await mkdtemp(path.join(tmpdir(), "mission-control-omi-"));
delete process.env.OMI_MCP_KEY;
process.env.OMI_MCP_KEY_FILE = path.join(root, "missing.key");
process.env.OMI_MCP_URL = "https://api.omi.me/v1/mcp/sse";
process.env.OMI_OBSIDIAN_INTAKE_DIR = path.join(root, "intake");

const { omiBridgeTestSupport, readOmiBridgeStatus } = await import("../src/lib/connectors/live/omi-bridge");
const { omiIntakeSchedulerTestSupport } = await import("../src/lib/connectors/live/omi-intake-scheduler");

test.after(async () => {
  await rm(root, { recursive: true, force: true });
});

test("missing MCP identity is reported without attempting a network read", async () => {
  const status = await readOmiBridgeStatus();
  assert.equal(status.status, "blocked");
  assert.equal(status.authentication, "missing");
  assert.deepEqual(status.counts, { memories: null, conversations: null });
  assert.equal(status.canonicalVaultMutation, false);
  assert.equal(JSON.stringify(status).includes("omi_mcp_"), false);
});

test("rate limits are distinct from rejected authentication", () => {
  assert.deepEqual(
    omiBridgeTestSupport.classifyConnectionError(new Error("HTTP 429: Rate exceeded")),
    { status: "rate_limited", authentication: "configured_unverified", message: "HTTP 429: Rate exceeded" }
  );
  assert.deepEqual(
    omiBridgeTestSupport.classifyConnectionError(new Error("HTTP 401: unauthorized")),
    { status: "blocked", authentication: "rejected", message: "HTTP 401: unauthorized" }
  );
});

test("candidate notes preserve source evidence and never claim canonical status", () => {
  const note = omiBridgeTestSupport.markdownForRecord(
    "memories",
    { id: "memory-1", title: "Sandbox law", content: "candidate evidence" },
    "2026-07-17T12:00:00.000Z"
  );
  assert.match(note, /classification: candidate/);
  assert.match(note, /canonical: false/);
  assert.match(note, /candidate evidence/);
  assert.match(note, /canonical until governed promotion/);
});

test("official MCP payload envelopes are parsed by collection", () => {
  assert.deepEqual(
    omiBridgeTestSupport.recordsFromPayload("memories", { memories: [{ id: "memory-1" }] }),
    [{ id: "memory-1" }]
  );
});

test("conversation detail envelope accepts direct and wrapped records", () => {
  assert.deepEqual(
    omiBridgeTestSupport.conversationDetailRecord({ id: "c1", transcript_segments: [] }),
    { id: "c1", transcript_segments: [] },
  );
  assert.deepEqual(
    omiBridgeTestSupport.conversationDetailRecord({ conversation: { id: "c1", transcript_segments: [] } }),
    { id: "c1", transcript_segments: [] },
  );
});

test("conversation detail ID mismatch fails closed", () => {
  assert.throws(
    () => omiBridgeTestSupport.validateConversationDetailIdentity({ id: "wrong" }, "expected"),
    /ID mismatch/,
  );
  assert.equal(
    omiBridgeTestSupport.validateConversationDetailIdentity({ id: "expected" }, "expected").id,
    "expected",
  );
});

test("conversation detail projection preserves semantic segments and excludes unrelated location", () => {
  const detail = {
    id: "c1",
    language: "nl",
    geolocation: { latitude: 1, longitude: 2 },
    structured: { title: "Test", overview: "Overview", category: "other", emoji: "🧠", private_extra: "drop" },
    transcript_segments: [
      { id: "s1", speaker: "Dennis", text: "Dit is echte inhoud", start: 1.25, end: 2.5, latitude: 51.9 },
    ],
  };
  const projected = omiBridgeTestSupport.semanticConversationDetail(detail);
  assert.equal(projected.id, "c1");
  assert.equal(projected.language, "nl");
  assert.equal((projected.structured as Record<string, unknown>).overview, "Overview");
  assert.equal("geolocation" in projected, false);
  const segment = (projected.transcript_segments as Record<string, unknown>[])[0];
  assert.equal(segment.text, "Dit is echte inhoud");
  assert.equal(segment.speaker, "Dennis");
  assert.equal("latitude" in segment, false);
  assert.ok(omiBridgeTestSupport.semanticTextLength(projected) > 0);
});

test("empty semantic detail is explicit and never fabricated", () => {
  const detail = { id: "c1", language: "nl", transcript_segments: [] };
  const projected = omiBridgeTestSupport.semanticConversationDetail(detail);
  assert.equal(omiBridgeTestSupport.semanticTextLength(projected), 0);
  const note = omiBridgeTestSupport.markdownForConversationDetail(detail, "2026-10-03T00:00:00.000Z");
  assert.match(note, /detail_content_present: false/);
  assert.match(note, /semantic_text_length: 0/);
});

test("detail snapshots are hash-addressed and append-only compatible", () => {
  const detailA = { id: "c1", transcript_segments: [{ text: "alpha" }] };
  const detailARepeat = { id: "c1", transcript_segments: [{ text: "alpha" }] };
  const detailB = { id: "c1", transcript_segments: [{ text: "beta" }] };
  assert.equal(
    omiBridgeTestSupport.detailArtifactFileName(detailA),
    omiBridgeTestSupport.detailArtifactFileName(detailARepeat),
  );
  assert.notEqual(
    omiBridgeTestSupport.detailArtifactFileName(detailA),
    omiBridgeTestSupport.detailArtifactFileName(detailB),
  );
  assert.match(omiBridgeTestSupport.detailArtifactFileName(detailA), /^c1\.detail\.[a-f0-9]{16}\.md$/);
});

test("detail candidate markdown preserves source id, candidate status and actual semantic text", () => {
  const note = omiBridgeTestSupport.markdownForConversationDetail(
    { id: "c1", transcript_segments: [{ speaker: "Dennis", text: "semantic payload" }] },
    "2026-10-03T00:00:00.000Z",
  );
  assert.match(note, /source_id: "c1"/);
  assert.match(note, /source_kind: "conversation_detail"/);
  assert.match(note, /classification: candidate/);
  assert.match(note, /canonical: false/);
  assert.match(note, /detail_content_present: true/);
  assert.match(note, /semantic payload/);
});

test("scheduled intake uses a conservative one-hour default and clamps aggressive cadence", () => {
  assert.equal(omiIntakeSchedulerTestSupport.resolveIntervalMs(undefined), 60 * 60 * 1000);
  assert.equal(omiIntakeSchedulerTestSupport.resolveIntervalMs("1"), 5 * 60 * 1000);
  assert.equal(omiIntakeSchedulerTestSupport.resolveIntervalMs("900000"), 900000);
  assert.equal(omiIntakeSchedulerTestSupport.resolveIntervalMs("invalid"), 60 * 60 * 1000);
});

test("scheduled intake initial delay is deterministic and configurable", () => {
  assert.equal(omiIntakeSchedulerTestSupport.resolveInitialDelayMs(undefined), 10_000);
  assert.equal(omiIntakeSchedulerTestSupport.resolveInitialDelayMs("0"), 0);
  assert.equal(omiIntakeSchedulerTestSupport.resolveInitialDelayMs("2500"), 2500);
  assert.equal(omiIntakeSchedulerTestSupport.resolveInitialDelayMs("invalid"), 10_000);
});

test("memory pull falls back to the default ordering only when the provider reports the sort as unavailable", () => {
  const attempts = omiBridgeTestSupport.memoryQueryAttempts(100);
  assert.deepEqual(attempts.map((a: Record<string, unknown>) => a.sort), ["updated_desc", "created_desc"]);
  for (const attempt of attempts) {
    assert.equal(attempt.include_sensitive, false);
    assert.equal(attempt.include_activity, false);
  }
  assert.equal(omiBridgeTestSupport.isSortUnavailableError(new Error('{"error":{"code":"unavailable","message":"Memory cursor unavailable"}}')), true);
  assert.equal(omiBridgeTestSupport.isSortUnavailableError(new Error("401 unauthorized")), false);
  assert.equal(omiBridgeTestSupport.isSortUnavailableError(new Error("429 rate exceeded")), false);
});
