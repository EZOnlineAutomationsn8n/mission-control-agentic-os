import assert from "node:assert/strict";
import test from "node:test";
import {
  CERTIFICATION_SCHEMA_VERSION,
  verifyClaudeNativeToolCertification,
} from "./claude-native-tool-cert";

const marker = "MC_ORDER013_CLAUDE_FINAL_SMOKE_FIXTURE";
const target = "/workspace/projects/mission-control/scripts/claude-native-tool-cert.ts";

function line(value: unknown): string {
  return JSON.stringify(value);
}

test("fresh tool certification requires matching native tool_use and tool_result after the marker", () => {
  const jsonl = [
    line({ type: "assistant", message: { content: [{ type: "tool_use", id: "old", name: "Read", input: { file_path: target } }] } }),
    line({ type: "user", message: { content: marker } }),
    line({ type: "assistant", message: { content: [{ type: "tool_use", id: "fresh-1", name: "Read", input: { file_path: target } }] } }),
    line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "fresh-1", content: "CERTIFICATION_SCHEMA_VERSION" }] } }),
    line({ type: "assistant", message: { content: [{ type: "text", text: marker + "\nMUTATION=NONE\nRESULT=PASS" }] } }),
  ].join("\n");

  const result = verifyClaudeNativeToolCertification({
    jsonl,
    marker,
    expectedToolName: "Read",
    expectedTarget: target,
  });

  assert.equal(result.schemaVersion, CERTIFICATION_SCHEMA_VERSION);
  assert.equal(result.markerUserEventFound, true);
  assert.equal(result.freshToolUseEvent, true);
  assert.equal(result.freshToolResultEvent, true);
  assert.equal(result.toolTargetMatchesRequest, true);
  assert.equal(result.realAgentResponse, true);
  assert.equal(result.mutationNone, true);
  assert.equal(result.toolUseId, "fresh-1");
});

test("self-reported READ_ONLY_TOOL_USE=PASS cannot certify without fresh native events", () => {
  const jsonl = [
    line({ type: "user", message: { content: marker } }),
    line({
      type: "assistant",
      message: {
        content: [{
          type: "text",
          text: marker + "\nREAD_ONLY_TOOL_USE=PASS\nMUTATION=NONE\nRESULT=PASS",
        }],
      },
    }),
  ].join("\n");

  const result = verifyClaudeNativeToolCertification({
    jsonl,
    marker,
    expectedToolName: "Read",
    expectedTarget: target,
  });

  assert.equal(result.markerUserEventFound, true);
  assert.equal(result.freshToolUseEvent, false);
  assert.equal(result.freshToolResultEvent, false);
  assert.equal(result.toolTargetMatchesRequest, false);
  assert.equal(result.realAgentResponse, true);
  assert.equal(result.mutationNone, true);
});
