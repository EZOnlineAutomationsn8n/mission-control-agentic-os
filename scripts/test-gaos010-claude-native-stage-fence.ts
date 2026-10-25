import assert from "node:assert/strict";
import {test} from "node:test";
import {readFileSync} from "node:fs";
import path from "node:path";
import {FALLBACK_MODEL_ROUTES} from "../src/lib/connectors/live/fcc-actions";
import {runClaudeCodeTurn} from "../src/lib/claude-code/runner";
import {prepareClaudeAfcStageSession} from "../src/lib/claude-code/session-store";
import type {ClaudeCodeSession} from "../src/lib/claude-code/session-store";

test("Twelve existing FCC operator routes keep their exact order",()=>{
  assert.equal(FALLBACK_MODEL_ROUTES.length,12);
  assert.equal(FALLBACK_MODEL_ROUTES[0],"open_router/poolside/laguna-xs-2.1:free");
  assert.equal(FALLBACK_MODEL_ROUTES[10],"open_router/nvidia/nemotron-3-ultra-550b-a55b:free");
  assert.equal(FALLBACK_MODEL_ROUTES[11],"open_router/openrouter/free");
});

test("No secondary FCC stage dispatch veto",()=>{
  const f=readFileSync(path.join(process.cwd(),"src/lib/connectors/live/fcc-actions.ts"),"utf8");
  assert.doesNotMatch(f,/stageFccPreDispatchVerdict/);
  assert.match(f,/FALLBACK_MODEL_ROUTES\.forEach/);
});

test("Claude stage prompt does not make a hidden FCC model preflight",()=>{
 const f=readFileSync(path.join(process.cwd(),"src/lib/claude-code/runner.ts"),"utf8");
 assert.match(f,/process\.env\.MC_PREVIEW === "1" \|\|/);
 assert.match(f,/runClaudeCodeTurn/);
 assert.match(f,/CLAUDE_STAGE_SESSION_ISOLATION_NOT_VERIFIED/);
});

test("Claude first stage prompt creates, subsequent prompt resumes same native UUID",()=>{
 const f=readFileSync(path.join(process.cwd(),"src/app/api/connectors/claude-code/actions/ask/route.ts"),"utf8");
 assert.match(f,/create: process\.env\.MC_PREVIEW==="1" && session\.status==="prepared"/);
 const runner=readFileSync(path.join(process.cwd(),"src/lib/claude-code/runner.ts"),"utf8");
 assert.match(runner,/createSession \? "--session-id" : "--resume"/);
 const start=readFileSync(path.join(process.cwd(),"src/app/api/connectors/claude-code/session/route.ts"),"utf8");
 assert.match(start,/prepared:true,bootstrapTurns:0/);
});

test("Native runner rejects non-isolated preview before any CLI child",async()=>{
 const session:ClaudeCodeSession={
  sessionKey:"acf-werkplaats-claude-code",
  claudeSessionId:"00000000-0000-4000-8000-000000000001",
  displayName:"stage",workspace:"/outside/workspace",permissionMode:"plan",
  executionMode:"on-demand-cli",status:"prepared",active:true,
  createdAt:"2026-10-24T00:00:00Z",updatedAt:"2026-10-24T00:00:00Z",lastError:null
 };
 const prev={preview:process.env.MC_PREVIEW,isolated:process.env.GAOS_STAGE_NATIVE_ISOLATED};
 try{
  process.env.MC_PREVIEW="1";process.env.GAOS_STAGE_NATIVE_ISOLATED="1";
  await assert.rejects(runClaudeCodeTurn({session,prompt:"NO_MODEL_REQUEST",create:true}),
   /CLAUDE_STAGE_SESSION_ISOLATION_NOT_VERIFIED/);
 }finally{
  if(prev.preview===undefined)delete process.env.MC_PREVIEW;else process.env.MC_PREVIEW=prev.preview;
  if(prev.isolated===undefined)delete process.env.GAOS_STAGE_NATIVE_ISOLATED;else process.env.GAOS_STAGE_NATIVE_ISOLATED=prev.isolated;
 }
});

test("PREPARED registry is not forged in LIVE or in alternate storage",async()=>{
 const prev={preview:process.env.MC_PREVIEW,isolated:process.env.GAOS_STAGE_NATIVE_ISOLATED,
  dir:process.env.CLAUDE_CODE_SESSION_DATA_DIR};
 try{
  process.env.MC_PREVIEW="0";process.env.GAOS_STAGE_NATIVE_ISOLATED="1";
  await assert.rejects(prepareClaudeAfcStageSession(),/CLAUDE_ACF_STAGE_PREPARE_NOT_ISOLATED/);
  process.env.MC_PREVIEW="1";process.env.CLAUDE_CODE_SESSION_DATA_DIR="/tmp/not-a-real-stage-store";
  await assert.rejects(prepareClaudeAfcStageSession(),/CLAUDE_ACF_STAGE_PREPARE_NOT_ISOLATED/);
 }finally{
  for(const [k,v] of Object.entries({
   MC_PREVIEW:prev.preview,GAOS_STAGE_NATIVE_ISOLATED:prev.isolated,CLAUDE_CODE_SESSION_DATA_DIR:prev.dir
  }))if(v===undefined)delete process.env[k];else process.env[k]=v;
 }
});
