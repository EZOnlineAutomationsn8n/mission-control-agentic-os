import assert from "node:assert/strict";
import test from "node:test";
import { mergeStageBoundCandidates } from "../src/lib/acf/control-adapter";
const pattern="^acf-werkplaats-[a-zA-Z0-9_-]{1,48}$";
const row=(agentId:string,sessionId:string,status:string)=>({agentId,sessionId,status,active:true,executionMode:"on-demand-cli"});

test("Hermes and OpenClaw remain owned by their certified shared executors",()=>{
  const shared=[row("hermes","acf-werkplaats-hermes","idle"),row("openclaw","acf-werkplaats-openclaw","idle"),
    row("codex","acf-werkplaats-codex","error")];
  const local=[row("hermes","acf-werkplaats-hermes","prepared"),row("codex","acf-werkplaats-codex","prepared")];
  const result=mergeStageBoundCandidates(shared,local,["codex"],pattern);
  assert.equal(result.find(x=>x.agentId==="hermes")?.status,"idle");
  assert.equal(result.find(x=>x.agentId==="openclaw")?.status,"idle");
  assert.equal(result.find(x=>x.agentId==="codex")?.status,"prepared");
  assert.equal(result.length,3);
});
test("workplace never imports personal or unrelated live session IDs",()=>{
  const result=mergeStageBoundCandidates(
    [row("gemini","operator-default","idle"),row("openclaw","acf-werkplaats-openclaw","idle")],
    [row("codex","operator-default","idle"),row("codex","acf-werkplaats-codex","prepared")],
    ["codex"],pattern
  );
  assert.deepEqual(result.map(x=>x.sessionId),["acf-werkplaats-openclaw","acf-werkplaats-codex"]);
});
test("stage session cannot enter when real ACF executor points at shared agent runtime",()=>{
  const result=mergeStageBoundCandidates([],[row("codex","acf-werkplaats-codex","idle")],[],pattern);
  assert.deepEqual(result,[]);
});
test("prepared stage sessions preserve their true status (no false ACF READY)",()=>{
  const result=mergeStageBoundCandidates([],[row("gemini","acf-werkplaats-gemini","prepared")],["gemini"],pattern);
  assert.equal(result[0].status,"prepared");
});
