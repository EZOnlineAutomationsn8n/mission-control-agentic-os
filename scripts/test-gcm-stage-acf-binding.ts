import {test} from "node:test";
import assert from "node:assert/strict";
import {reconcileStageCliCandidates} from "../src/lib/acf/control-adapter";

const pattern="^acf-werkplaats-[a-zA-Z0-9_-]{1,48}$";
const session=(agentId:string,sessionId:string,status="idle")=>({agentId,sessionId,status,active:true,executionMode:"on-demand-cli"});

test("All six stage agents derive from ONLY own stage registry",()=>{
 const remote=[
  session("hermes","acf-werkplaats-hermes"),
  session("openclaw","acf-werkplaats-openclaw"),
  session("codex","acf-werkplaats-codex","idle"),
  session("gemini","acf-werkplaats-gemini","idle"),
  session("codex","operator-default","idle"),
  session("claude-code","acf-werkplaats-claude-code","error"),
 ];
 const stage=[
  session("codex","acf-werkplaats-codex","prepared"),
  session("codex","operator-default"),
  session("gemini","acf-werkplaats-gemini","error"),
  session("hermes","acf-werkplaats-hermes","error"),
 ];
 const result=reconcileStageCliCandidates(remote,stage,pattern);
 assert.deepEqual(result.map(s=>[s.agentId,s.sessionId,s.status]),[
  ["codex","acf-werkplaats-codex","prepared"],
  ["gemini","acf-werkplaats-gemini","error"],
  ["hermes","acf-werkplaats-hermes","error"],
 ]);
});
test("No phantom production readiness for Hermes/OpenClaw/Claude/Codex/Gemini",()=>{
 assert.deepEqual(reconcileStageCliCandidates([
  session("codex","acf-werkplaats-codex"),
  session("gemini","acf-werkplaats-gemini"),
  session("hermes","acf-werkplaats-hermes"),
  session("openclaw","acf-werkplaats-openclaw"),
  session("claude-code","acf-werkplaats-claude-code")],[],pattern),[]);
});
test("ACF stage 'prepared' is not a fake idle eligible session",()=>{
 const r=reconcileStageCliCandidates([],[
  session("codex","acf-werkplaats-codex","prepared")],pattern);
 assert.equal(r[0].status,"prepared");
 assert.notEqual(r[0].status,"idle");
});
