import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,readFile,writeFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
import {POST} from "../src/app/api/connectors/claude-code/session/route";
import {POST as POST_ASK} from "../src/app/api/connectors/claude-code/actions/ask/route";
import {validateClaudeRecoverExisting,validateNativePendingTurns,CLAUDE_R2_KEY} from "../src/lib/claude-code/recover-existing";
import {readClaudeCodeSession} from "../src/lib/claude-code/session-store";

const key=CLAUDE_R2_KEY;
const uuid="e8c09f35-0011-480f-9a21-d6a5d5dc2ca1";
const otherUuid="e8c09f35-0011-480f-9a21-d6a5d5dc2ca2";
type Row={
 sessionKey:string;claudeSessionId:string;displayName:string;workspace:string;
 permissionMode:"plan";executionMode:"on-demand-cli";status:"error"|"idle"|"prepared";
 active:boolean;createdAt:string;updatedAt:string;lastError:string|null;
 historyLastError?:string|null;recoveryHold?:boolean;
};
function original(overrides:Partial<Row>={}):Row{
 return {sessionKey:key,claudeSessionId:uuid,displayName:"fixture",
  workspace:"/isolated-r2-fixture",permissionMode:"plan",executionMode:"on-demand-cli",
  status:"error",active:false,createdAt:"2026-10-22T14:00:00.000Z",
  updatedAt:"2026-10-22T14:51:26.928Z",lastError:"FIXTURE_UNRECOGNIZED_MODEL",...overrides};
}
function request(k:string=key,id:string=uuid,headers=true){
 return new Request("http://local.invalid/api/connectors/claude-code/session?sessionId="+encodeURIComponent(k),{
  method:"POST",headers:{"content-type":"application/json",
   ...(headers?{"origin":"https://mc.vireonhq.cloud:8443","authorization":"Basic YWFhYWFhYWFhYWFh","sec-fetch-site":"same-origin"}:{})},
  body:JSON.stringify({action:"recover-existing",expectedNativeUuid:id})
 });
}
async function fixture(fn:(ctx:{dir:string,rows:Record<string,Row>})=>Promise<void>,
 overrides:Partial<Row>={}){
 const dir=await mkdtemp(path.join(tmpdir(),"gaos-r2-unit-"));
 const previous=Object.fromEntries(["MC_PREVIEW","GAOS_STAGE_NATIVE_ISOLATED","DATABASE_URL",
  "CLAUDE_CODE_SESSION_DATA_DIR","AGENT_CONVERSATION_DATA_DIR","AUDIT_DATA_DIR"].map(k=>[k,process.env[k]]));
 const oldFetch=globalThis.fetch;
 process.env.MC_PREVIEW="1";process.env.GAOS_STAGE_NATIVE_ISOLATED="1";
 delete process.env.DATABASE_URL;
 process.env.CLAUDE_CODE_SESSION_DATA_DIR=dir;
 process.env.AGENT_CONVERSATION_DATA_DIR=dir;
 process.env.AUDIT_DATA_DIR=dir;
 globalThis.fetch=async(input:RequestInfo|URL)=>{
  const u=String(input);
  assert.equal(u,"https://mc.vireonhq.cloud:8443/api/preview-identity","no unmocked remote request");
  return Response.json({preview:true});
 };
 const second=original({sessionKey:"unrelated-production-protected",claudeSessionId:otherUuid});
 const rows={[key]:original(overrides),[second.sessionKey]:second};
 try{
  await writeFile(path.join(dir,"claude-code-sessions.json"),JSON.stringify(rows));
  await fn({dir,rows});
  const after=JSON.parse(await readFile(path.join(dir,"claude-code-sessions.json"),"utf8"));
  assert.deepEqual(after[second.sessionKey],second,"other session remains byte-identical");
 }finally{
  globalThis.fetch=oldFetch;
  for(const [k,v] of Object.entries(previous)){
   if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
  await rm(dir,{recursive:true,force:true});
 }
}
test("CAS exact fixture once: same UUID, original error history, audit, no model calls",async()=>{
 await fixture(async({dir,rows})=>{
  const res=await POST(request());
  assert.equal(res.status,200);
  const d=await res.json();
  assert.equal(d.code,"RECOVERY_CAS_APPLIED");
  assert.equal(d.nativeTurnAllowed,false);
  assert.equal(d.modelCalls,0);
  assert.equal(d.auditRecorded,true);
  const updated=await readClaudeCodeSession(key);
  assert.equal(updated?.status,"prepared");
  assert.equal(updated?.active,true);
  assert.equal(updated?.claudeSessionId,uuid);
  assert.equal(updated?.historyLastError,rows[key].lastError);
  assert.equal(updated?.lastError,null);
  assert.equal(updated?.recoveryHold,true);
  const ask=await POST_ASK(new Request("http://local.invalid/api/connectors/claude-code/actions/ask",{
   method:"POST",headers:{"content-type":"application/json"},
   body:JSON.stringify({sessionId:key,prompt:"must never run"}),
  }));
  assert.equal(ask.status,409);
  assert.equal((await ask.json()).error,"CLAUDE_R2_RECOVERY_HOLD_USE_RECOVERY_RESUME");
  const audit=await readFile(path.join(dir,"audit-log.jsonl"),"utf8");
  assert.match(audit,/claude-code-session-recover-existing/);
  const retry=await POST(request());
  assert.equal(retry.status,409);
  const j=await retry.json();assert.equal(j.error,"RECOVERY_STATUS_MISMATCH");
 });
});
test("CAS concurrent requests: exactly one success and one 409",async()=>{
 await fixture(async()=>{
  const results=await Promise.all([POST(request()),POST(request())]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
 });
});
test("wrong UUID fails 409 without changing fixture or audit",async()=>{
 await fixture(async({dir,rows})=>{
  const res=await POST(request(key,otherUuid));
  assert.equal(res.status,409);
  assert.deepEqual(await readClaudeCodeSession(key),rows[key]);
  await assert.rejects(()=>readFile(path.join(dir,"audit-log.jsonl"),"utf8"),{code:"ENOENT"});
 });
});
test("invalid key, forged operator, and non-isolated boundary reject",async()=>{
 await fixture(async({rows})=>{
  assert.equal((await POST(request("other-session"))).status,403);
  assert.equal((await POST(request(key,uuid,false))).status,403);
  const before=process.env.GAOS_STAGE_NATIVE_ISOLATED;
  process.env.GAOS_STAGE_NATIVE_ISOLATED="0";
  const shared=await POST(request());
  assert.equal(shared.status,409);
  assert.equal((await shared.json()).error,"CLAUDE_EXISTING_SESSION_NO_START_STOP_OR_RESET");
  process.env.GAOS_STAGE_NATIVE_ISOLATED=before;
  assert.deepEqual(await readClaudeCodeSession(key),rows[key]);
 });
});
test("prepared/active or stopped/idle status cannot be overwritten",async()=>{
 for(const o of [{status:"prepared" as const,active:true},{status:"idle" as const,active:true},
  {status:"error" as const,active:true}]){
  await fixture(async({rows})=>{
   assert.equal((await POST(request())).status,409);
   assert.deepEqual(await readClaudeCodeSession(key),rows[key]);
  },o);
 }
});
test("existing historical error field fails closed rather than being overwritten",async()=>{
 await fixture(async({rows})=>{
  assert.equal((await POST(request())).status,409);
  assert.deepEqual(await readClaudeCodeSession(key),rows[key]);
 },{historyLastError:"earlier incident"});
});
test("pending/uncertain native outcomes fail closed before any session mutation",async()=>{
 const unknown={agentId:"claude-code",sessionId:key,agentSessionId:uuid,status:"timeout"};
 assert.equal(validateNativePendingTurns([unknown],key,uuid,true),"RECOVERY_PENDING_OR_UNCERTAIN_TURN");
 assert.equal(validateNativePendingTurns([],key,uuid,false),"RECOVERY_HISTORY_NOT_EXHAUSTIVE");
 assert.equal(validateNativePendingTurns([{...unknown,status:"failed",agentSessionId:otherUuid}],key,uuid,true),
  "RECOVERY_HISTORY_FOREIGN_UUID");
 await fixture(async({dir,rows})=>{
  await writeFile(path.join(dir,"agent-conversations.jsonl"),JSON.stringify({...unknown,id:randomUUID()})+"\n");
  assert.equal((await POST(request())).status,409);
  assert.deepEqual(await readClaudeCodeSession(key),rows[key]);
 });
});
test("mismatched missing history is denied by pure CAS policy",()=>{
 assert.equal(validateClaudeRecoverExisting(null,key,uuid),"RECOVERY_SESSION_NOT_FOUND");
 assert.equal(validateClaudeRecoverExisting(original({lastError:null}),key,uuid),"RECOVERY_HISTORICAL_ERROR_REQUIRED");
 assert.equal(validateClaudeRecoverExisting(original({claudeSessionId:otherUuid}),key,uuid),"RECOVERY_NATIVE_UUID_MISMATCH");
});
test("DB CAS SQL compares exact key UUID error inactive and historical fields without UPSERT",async()=>{
 const source=await readFile("src/lib/persistence/session-repository.ts","utf8");
 const block=source.slice(source.indexOf("export async function recoverExistingClaudePersistedSession"));
 for(const marker of ["session_kind='claude-code'","agent_id='claude-code'",
  "'acf-werkplaats-claude-code'","claudeSessionId","historyLastError",
  "updatedAt","'status'='error'","payload->'active'='false'::jsonb","RETURNING payload"])
  assert.ok(block.includes(marker),marker);
 assert.doesNotMatch(block,/INSERT INTO|ON CONFLICT|DELETE FROM/);
});
