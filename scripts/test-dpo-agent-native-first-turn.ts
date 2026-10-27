import assert from "node:assert/strict";
import test from "node:test";
import { isPreparedStageNativeFirstTurn } from "../src/lib/cli-agents/first-native-turn";

test("prepared Codex never resumes with the registry placeholder; it creates a native thread",()=>{
  assert.equal(isPreparedStageNativeFirstTurn(true,"codex","prepared"),true);
  assert.equal(isPreparedStageNativeFirstTurn(true,"codex","idle"),false);
  assert.equal(isPreparedStageNativeFirstTurn(false,"codex","prepared"),false);
});
test("Gemini prepared stage session creates a native thread only on Dennis prompt",()=>{
  assert.equal(isPreparedStageNativeFirstTurn(true,"gemini","prepared"),true);
  assert.equal(isPreparedStageNativeFirstTurn(true,"gemini","error"),false);
  assert.equal(isPreparedStageNativeFirstTurn(false,"gemini","prepared"),false);
});
test("already certified Hermes and OpenClaw semantics remain unchanged",()=>{
  assert.equal(isPreparedStageNativeFirstTurn(true,"hermes","prepared"),true);
  assert.equal(isPreparedStageNativeFirstTurn(true,"openclaw","prepared"),false);
});
test("AGY optional orchestrator is never bootstrapped by this ACF participant helper",()=>{
  assert.equal(isPreparedStageNativeFirstTurn(true,"agy","prepared"),false);
});
