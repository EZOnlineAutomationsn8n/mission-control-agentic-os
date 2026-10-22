import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";

const root = await mkdtemp(path.join(tmpdir(), "mc-local-pixel-test-"));
delete process.env.DATABASE_URL;
process.env.ATTACHMENT_DATA_DIR = root;
const { storeAttachments, resolveAttachments } = await import("../src/lib/attachments/store");
const { inspectLocalImagePixels, promptWithLocalPixelEvidence } = await import("../src/lib/attachments/local-pixel-observation");
test.after(async () => { await rm(root, { recursive: true, force: true }); });

async function image(left: string, right: string) {
  const bytes = await sharp({ create: { width: 48, height: 24, channels: 3, background: left } })
    .composite([{ input: { create: { width: 24, height: 24, channels: 3, background: right } }, top: 0, left: 24 }])
    .png().toBuffer();
  return new File([new Uint8Array(bytes)], "image.png", { type: "image/png" });
}

test("real image pixels, not identical name and prompt, determine opposite left/right visual facts", async () => {
  const [a] = await storeAttachments({ agentId: "openclaw", sessionId: "vision-test", files: [await image("#ff0000", "#0000ff")] });
  const [b] = await storeAttachments({ agentId: "openclaw", sessionId: "vision-test", files: [await image("#0000ff", "#ff0000")] });
  const first = await inspectLocalImagePixels(a);
  const second = await inspectLocalImagePixels(b);
  assert.match(first ?? "", /left half red (?:9\d|100)%/);
  assert.match(first ?? "", /right half blue (?:9\d|100)%/);
  assert.match(second ?? "", /left half blue (?:9\d|100)%/);
  assert.match(second ?? "", /right half red (?:9\d|100)%/);
  assert.notEqual(first, second);
  const original = await promptWithLocalPixelEvidence("What visual evidence is available?", [a]);
  assert.match(original, /LOCAL IMAGE PIXEL EVIDENCE/);
  assert.match(original, /not establish objects, words, persons/);
  assert.doesNotMatch(original, /base64/);
});

test("stored scope prevents reuse by another agent/session", async () => {
  const [a] = await storeAttachments({ agentId: "hermes", sessionId: "scope-a", files: [await image("#00ff00", "#ff0000")] });
  await assert.rejects(resolveAttachments({ agentId: "hermes", sessionId: "scope-b", ids: [a.id] }), /missing or outside/);
  await assert.rejects(resolveAttachments({ agentId: "openclaw", sessionId: "scope-a", ids: [a.id] }), /missing or outside/);
});

test("spoofed or corrupt image fails closed, no model message constructed", async () => {
  const [corrupt] = await storeAttachments({agentId:"openclaw", sessionId:"corrupt", files:[new File(["this is not pixels"], "image.png", {type:"image/png"})]});
  await assert.rejects(promptWithLocalPixelEvidence("Describe photo", [corrupt]), /VISION_LOCAL_PIXEL_INSPECTION_FAILED/);
  const [vector] = await storeAttachments({agentId:"openclaw", sessionId:"vector", files:[new File(["<svg/>"] ,"image.svg", {type:"image/svg+xml"})]});
  await assert.rejects(promptWithLocalPixelEvidence("Describe photo", [vector]), /VISION_IMAGE_FORMAT_UNSUPPORTED/);
});

test("nonimage files retain existing attachment path behavior", async () => {
  const [text] = await storeAttachments({ agentId: "claude-code", sessionId: "documents", files: [new File(["hello"], "note.txt", { type: "text/plain" })] });
  const prompt = await promptWithLocalPixelEvidence("Read document", [text]);
  assert.match(prompt, /note\.txt/);
  assert.doesNotMatch(prompt, /LOCAL IMAGE PIXEL EVIDENCE/);
});

test("upload endpoint exposes measured pixels, then agent routes reject paid/unverified vision before model execution", async () => {
  const { POST: upload } = await import("../src/app/api/attachments/route");
  const form = new FormData();
  form.set("agentId", "openclaw");
  form.set("sessionId", "vision-guard");
  form.append("files", await image("#ff0000", "#0000ff"));
  const uploadResponse = await upload(new Request("http://localhost/api/attachments", { method: "POST", body: form }));
  assert.equal(uploadResponse.status, 201);
  const returned = await uploadResponse.json() as { attachments: Array<{ id: string }>; localImageObservations: Array<{ status: string; text: string }> };
  assert.equal(returned.localImageObservations[0]?.status, "measured");
  assert.match(returned.localImageObservations[0]?.text ?? "", /left half red (?:9\d|100)%/);
  const { askCliAgent } = await import("../src/lib/cli-agents/api");
  const askResponse = await askCliAgent(new Request("http://localhost/api/connectors/openclaw/actions/ask", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ prompt: "What object is shown?", sessionId: "vision-guard", attachments: [returned.attachments[0].id] }),
  }), "openclaw");
  assert.equal(askResponse.status, 422);
  const refusal = await askResponse.json() as { error: string };
  assert.match(refusal.error, /VISION_MODEL_NOT_VERIFIED/);
});

test("Claude Code image handoff rejects unverified vision, without contacting FCC", async () => {
  const [imageRecord] = await storeAttachments({agentId:"claude-code",sessionId:"vision-guard-claude",files:[await image("#0000ff","#ff0000")]});
  const { POST } = await import("../src/app/api/connectors/claude-code/actions/ask/route");
  const response = await POST(new Request("http://localhost/api/connectors/claude-code/actions/ask", {
    method:"POST", headers:{"content-type":"application/json"},
    body:JSON.stringify({prompt:"Describe photo",sessionId:"vision-guard-claude",attachments:[imageRecord.id]})
  }));
  assert.equal(response.status,422);
  assert.match((await response.json()).error,/VISION_MODEL_NOT_VERIFIED/);
});
