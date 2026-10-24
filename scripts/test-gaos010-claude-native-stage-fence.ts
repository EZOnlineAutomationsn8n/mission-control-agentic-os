import assert from "node:assert/strict";
import {test} from "node:test";
import {FALLBACK_MODEL_ROUTES,sendFccControlledPrompt,stageFccPreDispatchVerdict} from "../src/lib/connectors/live/fcc-actions";
import {runClaudeCodeTurn} from "../src/lib/claude-code/runner";
import {prepareClaudeAfcStageSession} from "../src/lib/claude-code/session-store";
import type {ClaudeCodeSession} from "../src/lib/claude-code/session-store";

const old={preview:process.env.MC_PREVIEW,isolated:process.env.GAOS_STAGE_NATIVE_ISOLATED,
  path:process.env.CLAUDE_CODE_SESSION_DATA_DIR};
const restore=()=>{
  for(const [key,value] of Object.entries({
    MC_PREVIEW:old.preview,GAOS_STAGE_NATIVE_ISOLATED:old.isolated,CLAUDE_CODE_SESSION_DATA_DIR:old.path
  }))if(value===undefined)delete process.env[key];else process.env[key]=value;
};

test("stage-only FCC guard refuses direct FCC preflight without provider fetch",async()=>{
  let fetches=0;
  const origFetch=globalThis.fetch;
  try{
    process.env.MC_PREVIEW="1";
    globalThis.fetch=(async()=>{fetches++;throw Error("PROVIDER_FETCH_FORBIDDEN")}) as typeof fetch;
    const before=[...FALLBACK_MODEL_ROUTES];
    const response=await sendFccControlledPrompt("NO PROVIDER CALL");
    assert.equal(response.status,"failed");
    assert.equal(response.attempts.length,0);
    assert.match(response.error||"",/FCC_STAGE_NATIVE_GUARD_NOT_EFFECTIVE/);
    assert.equal(fetches,0);
    assert.deepEqual(FALLBACK_MODEL_ROUTES,before,"all 12 operator routes kept untouched");
  }finally{globalThis.fetch=origFetch;restore()}
});

test("runner stage fence rejects before even launcher version probe or route preflight",async()=>{
  const s:ClaudeCodeSession={
    sessionKey:"acf-werkplaats-claude-code",claudeSessionId:"00000000-0000-4000-8000-000000000001",
    displayName:"stage-test",workspace:"/not-an-executable",permissionMode:"plan",
    executionMode:"on-demand-cli",status:"prepared",active:true,
    createdAt:"2026-10-24T00:00:00Z",updatedAt:"2026-10-24T00:00:00Z",lastError:null
  };
  try{
    process.env.MC_PREVIEW="1";
    process.env.CLAUDE_CODE_LAUNCHER="/definitely/no/native/binary";
    process.env.CLAUDE_CODE_SKIP_ROUTE_PREFLIGHT="1";
    await assert.rejects(runClaudeCodeTurn({session:s,prompt:"NOT A MODEL CALL",create:true}),
      /FCC_STAGE_NATIVE_GUARD_NOT_EFFECTIVE/);
    assert.equal(stageFccPreDispatchVerdict().canDispatch,false);
  }finally{
    delete process.env.CLAUDE_CODE_LAUNCHER;delete process.env.CLAUDE_CODE_SKIP_ROUTE_PREFLIGHT;restore();
  }
});

test("no forged ACF prep in production or non-stage data dir",async()=>{
 try{
   process.env.MC_PREVIEW="0";process.env.GAOS_STAGE_NATIVE_ISOLATED="1";
   await assert.rejects(prepareClaudeAfcStageSession(),/CLAUDE_ACF_STAGE_PREPARE_NOT_ISOLATED/);
   process.env.MC_PREVIEW="1";process.env.CLAUDE_CODE_SESSION_DATA_DIR="/tmp/untrusted-live-sessions";
   await assert.rejects(prepareClaudeAfcStageSession(),/CLAUDE_ACF_STAGE_PREPARE_NOT_ISOLATED/);
 }finally{restore()}
});
test("stage-only scope does not change normal LIVE FCC model list",()=>{
 try{
   process.env.MC_PREVIEW="0";
   assert.equal(stageFccPreDispatchVerdict().canDispatch,true);
   assert.equal(FALLBACK_MODEL_ROUTES.length,12);
   assert.equal(FALLBACK_MODEL_ROUTES.at(-1),"open_router/openrouter/free");
 }finally{restore()}
});
