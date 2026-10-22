import test from "node:test";
import assert from "node:assert/strict";
import { readSuccessfulOpenClawText, type OpenClawResult } from "../src/lib/cli-agents/openclaw-runner";

test("normal OpenClaw answer remains successful", () => {
  const payload: OpenClawResult = {
    status: "ok",
    result: {
      payloads: [{ text: "OPENCLAW_NORMAL_OK" }],
      meta: {
        agentMeta: {
          sessionId: "normal-session",
          provider: "openrouter",
          model: "example/model",
        },
      },
    },
  };

  assert.equal(readSuccessfulOpenClawText(payload), "OPENCLAW_NORMAL_OK");
});

test("OpenClaw incomplete_turn is failed structurally even when status is ok and placeholder text is present", () => {
  const payload: OpenClawResult = {
    status: "ok",
    result: {
      payloads: [{
        text: "⚠️ Agent couldn't generate a response. Please try again.",
        isError: true,
      }],
      meta: {
        error: {
          kind: "incomplete_turn",
          message: "Agent couldn't generate a response.",
          fallbackSafe: true,
        },
      },
    },
  };

  assert.throws(
    () => readSuccessfulOpenClawText(payload),
    /OpenClaw agent turn failed: incomplete_turn: Agent couldn't generate a response\./
  );
});

test("OpenClaw error payload without meta error is failed structurally", () => {
  const payload: OpenClawResult = {
    status: "ok",
    result: {
      payloads: [{ text: "provider error", isError: true }],
    },
  };

  assert.throws(
    () => readSuccessfulOpenClawText(payload),
    /OpenClaw agent turn failed: error payload: provider error/
  );
});

test("OpenClaw non-ok status retains failure behavior", () => {
  const payload: OpenClawResult = {
    status: "error",
    result: { payloads: [{ text: "not successful" }] },
  };

  assert.throws(
    () => readSuccessfulOpenClawText(payload),
    /OpenClaw agent turn returned no successful response/
  );
});
