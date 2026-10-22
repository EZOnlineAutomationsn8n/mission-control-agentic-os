import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseGeminiStreamEvents } from "../src/lib/cli-agents/gemini-runner";

async function stream(name: string): Promise<string> {
  return readFile(new URL("./fixtures/" + name, import.meta.url), "utf8");
}

test("mixed user+assistant stream excludes user prompt, tool and unattributed messages", async () => {
  const parsed = parseGeminiStreamEvents(await stream("gemini-stream-mixed-roles.ndjson"), "previous-gemini-id");
  assert.equal(parsed.text, "The existing dashboard is ready for review.");
  assert.ok(!parsed.text.includes("PROMPT_ECHO_MUST_NOT_APPEAR"));
  assert.ok(!parsed.text.includes("TOOL_MESSAGE_MUST_NOT_APPEAR"));
  assert.ok(!parsed.text.includes("UNATTRIBUTED_MESSAGE_MUST_NOT_APPEAR"));
  assert.equal(parsed.sessionId, "gemini-native-id-001");
  assert.equal(parsed.model, "gemini-free");
});

test("final-result handling keeps final Gemini response, not the user echo", async () => {
  const parsed = parseGeminiStreamEvents(await stream("gemini-stream-final-result.ndjson"), "previous-gemini-id");
  assert.equal(parsed.text, "Final Gemini assistant response.");
  assert.ok(!parsed.text.includes("PROMPT_ECHO_MUST_NOT_APPEAR"));
  assert.equal(parsed.sessionId, "gemini-reused-session-002");
  assert.equal(parsed.model, "gemini-free");
});

test("a stream with only user-role messages fails instead of echoing the prompt", async () => {
  assert.throws(() => parseGeminiStreamEvents(
    `{"type":"init","session_id":"native-gemini-003"}\n{"type":"message","role":"user","content":"PROMPT_ECHO_MUST_NOT_APPEAR"}\n`,
    "previous-gemini-id",
  ), /Gemini returned no final agent message/);
});

test("fixture user-only stream also fails closed", async () => {
  const recorded = await stream("gemini-stream-user-only.ndjson");
  assert.throws(() => parseGeminiStreamEvents(recorded, "previous-gemini-id"),
    /Gemini returned no final agent message/);
});

test("caller native session ID persists when no new session ID is reported", () => {
  const stream = [
    JSON.stringify({ type: "message", role: "user", content: "PROMPT_ECHO_MUST_NOT_APPEAR" }),
    JSON.stringify({ type: "message", role: "assistant", content: "Actual assistant reply." }),
  ].join("\n");
  const parsed = parseGeminiStreamEvents(stream, "original-native-session-uuid");
  assert.equal(parsed.sessionId, "original-native-session-uuid");
  assert.equal(parsed.text, "Actual assistant reply.");
  assert.equal(parsed.model, null);
});

test("malformed, empty, and tool-only lines do not override assistant output", () => {
  const stream = [
    "{invalid-json",
    JSON.stringify({type:"message",role:"tool",content:"UNTRUSTED_TOOL_TEXT"}),
    JSON.stringify({type:"message",role:"assistant",content:"Valid assistant text."}),
    "",
  ].join("\n");
  const parsed = parseGeminiStreamEvents(stream, "persisted-id");
  assert.equal(parsed.text, "Valid assistant text.");
  assert.equal(parsed.sessionId, "persisted-id");
});
