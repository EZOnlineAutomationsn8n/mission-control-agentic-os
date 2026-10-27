import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

const base=await mkdtemp(path.join(tmpdir(),"mc-weg2-offline-"));
const prior={
 db:process.env.DATABASE_URL,session:process.env.CLI_AGENT_SESSION_DATA_DIR,
 audit:process.env.AUDIT_DATA_DIR,preview:process.env.MC_PREVIEW,
};
delete process.env.DATABASE_URL;
process.env.CLI_AGENT_SESSION_DATA_DIR=base;
process.env.AUDIT_DATA_DIR=base;
process.env.MC_PREVIEW="1";
const {changeCliAgentSession}=await import("../src/lib/cli-agents/api");
const {readCliAgentSession,claimPreparedCliAgentSession}=await import("../src/lib/cli-agents/session-store");
const {readAuditEvents}=await import("../src/lib/audit-log-store");
test.after(async()=>{
 await rm(base,{recursive:true,force:true});
 if(prior.db!==undefined)process.env.DATABASE_URL=prior.db;
 else delete process.env.DATABASE_URL;
 if(prior.session!==undefined)process.env.CLI_AGENT_SESSION_DATA_DIR=prior.session;
 else delete process.env.CLI_AGENT_SESSION_DATA_DIR;
 if(prior.audit!==undefined)process.env.AUDIT_DATA_DIR=prior.audit;
 else delete process.env.AUDIT_DATA_DIR;
 if(prior.preview!==undefined)process.env.MC_PREVIEW=prior.preview;
 else delete process.env.MC_PREVIEW;
});
const url=(agent:string,key:string)=>`http://local.test/api/connectors/${agent}/session?sessionId=${key}`;
const registration=async(agent:"gemini"|"codex"|"agy"|"hermes",key:string,action="prepare")=>{
 const response=await changeCliAgentSession(new Request(url(agent,key),{
  method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({action}),
 }),agent);
 return {status:response.status,body:await response.json()};
};
test("three existing WEG2 agents register prepared without bootstrap or provider call",async()=>{
 for(const agent of ["gemini","codex","agy"] as const){
  const key=`acf-werkplaats-weg2-${agent}`;
  const {status,body}=await registration(agent,key);
  assert.equal(status,200);
  assert.equal(body.prepared,true);
  assert.equal(body.firstTurnByOperator,true);
  assert.equal(body.modelCalls,0);
  assert.equal(body.auditRecorded,true);
  assert.equal(body.session.status,"prepared");
  assert.equal(body.session.active,true);
  assert.equal((await readCliAgentSession(agent,key))?.status,"prepared");
 }
 const entries=await readAuditEvents();
 for(const agent of ["gemini","codex","agy"] as const){
  assert.equal(entries.filter(e=>e.actionType===`${agent}-session-prepare`).length,1);
 }
});
test("duplicate across concurrent registrations returns 409 without replacing existing session",async()=>{
 const agent="gemini",key="acf-werkplaats-concurrent-01";
 const replies=await Promise.all([registration(agent,key),registration(agent,key)]);
 assert.deepEqual(replies.map(x=>x.status).sort(),[200,409]);
 assert.equal(replies.find(x=>x.status===409)?.body.error,"SESSION_ALREADY_EXISTS_NO_RESET");
 const original=(await readCliAgentSession(agent,key))!;
 const repeated=await registration(agent,key);
 assert.equal(repeated.status,409);
 assert.deepEqual(await readCliAgentSession(agent,key),original);
 const entries=await readAuditEvents();
 assert.equal(entries.filter(e=>e.actionType==="gemini-session-prepare"&&e.resultSummary.includes(key)).length,1);
});
test("keys, unsupported agents, and legacy start are all denied without provider call",async()=>{
 assert.equal((await registration("gemini","gemini-session-live-01")).status,400);
 assert.equal((await registration("agy","operator-default")).status,400);
 assert.equal((await registration("hermes","acf-werkplaats-hermes")).status,400);
 const legacy=await registration("codex","acf-werkplaats-start-01","start");
 assert.equal(legacy.status,409);
 assert.equal(legacy.body.error,"USE_PREPARE_FOR_WORKSHOP_SESSION");
 assert.equal(await readCliAgentSession("codex","acf-werkplaats-start-01"),null);
});
test("native first turn is claimed once, never dispatched by duplicate concurrent claims",async()=>{
 const key="acf-werkplaats-claim-codex";
 assert.equal((await registration("codex",key)).status,200);
 const claims=await Promise.all([
  claimPreparedCliAgentSession("codex",key),
  claimPreparedCliAgentSession("codex",key),
 ]);
 assert.equal(claims.filter(Boolean).length,1);
 assert.equal((await readCliAgentSession("codex",key))?.status,"running");
 assert.equal(await claimPreparedCliAgentSession("codex",key),null);
});
test("fixture never opens real sessions, and audit has only preparation entries",async()=>{
 const file=JSON.parse(await readFile(path.join(base,"cli-agent-sessions.json"),"utf8")) as Record<string,{status:string}>;
 assert.ok(Object.values(file).every(x=>["prepared","running"].includes(x.status)));
 assert.equal((await readAuditEvents()).every(e=>e.actionType.endsWith("-session-prepare")),true);
});
