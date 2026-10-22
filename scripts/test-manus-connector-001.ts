import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,chmodSync,symlinkSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import path from "node:path";
import {readManusApiKey,requestManusV2,submitManusTask,readManusTask,readManusMessages,getManusStatus,sendManusFollowup,ManusConnectorError} from "../src/lib/connectors/live/manus-v2";
import {COCKPIT_AGENT_TARGETS} from "../src/lib/cockpit/agent-registry";
const beforeProcessKey=process.env.MANUS_API_KEY_FILE;
const dir=mkdtempSync(path.join(tmpdir(),"mc-manus-no-key-"));
const file=path.join(dir,"manus-api-key");
process.env.MANUS_API_KEY_FILE=file;
const dummy="manus_test_key_does_not_contact_any_provider_0001";
const calls:{url:string;method:string;header:string;body:string}[]=[];
const handler=async(input:RequestInfo|URL,init?:RequestInit):Promise<Response>=>{
  const url=String(input);
  calls.push({url,method:String(init?.method),header:String(new Headers(init?.headers).get("x-manus-api-key")),body:String(init?.body||"")});
  if(url.endsWith("user.me")) return Response.json({ok:true,user_id:"mock_user"});
  if(url.endsWith("task.create"))return Response.json({ok:true,task_id:"task_mock_a",request_id:"mock_req"});
  if(url.endsWith("task.sendMessage"))return Response.json({ok:true,task_id:"task_mock_a",request_id:"mock_followup_req"});
  if(url.includes("task.detail"))return Response.json({ok:true,task:{id:"task_mock_a",status:"stopped",credit_usage:0}});
  if(url.includes("task.listMessages"))return Response.json({ok:true,task_id:"task_mock_a",messages:[{id:"ev1",type:"assistant_message",assistant_message:{content:"MOCK_RESULT"}}]});
  throw new Error("UNEXPECTED_ENDPOINT");
};
const mock=handler as typeof fetch;
const reject=(error:unknown,code:string)=>error instanceof ManusConnectorError && error.code===code;
test("no key fail-closed; no network calls",async()=>{
 assert.equal((await readManusApiKey()).status,"missing");
 const status=await getManusStatus(mock);
 assert.equal(status.connection,"pending-key");
 await assert.rejects(submitManusTask({prompt:"never run",acknowledgeManusCreditUsage:true},{fetcher:mock}),e=>reject(e,"MANUS_KEY_MISSING"));
 assert.equal(calls.length,0);
});
test("insecure file permission refuses key",async()=>{
 writeFileSync(file,dummy,{mode:0o644});chmodSync(file,0o644);
 assert.equal((await readManusApiKey()).status,"invalid-permissions");
 assert.equal((await getManusStatus(mock)).connection,"blocked");
 assert.equal(calls.length,0);
});
test("symlink key file refused",async()=>{
 rmSync(file);const target=path.join(dir,"target");
 writeFileSync(target,dummy,{mode:0o600});symlinkSync(target,file);
 assert.equal((await readManusApiKey()).status,"invalid-permissions");
 rmSync(file);
});
test("safe file config recognized without exposing the key",async()=>{
 writeFileSync(file,dummy,{mode:0o600});chmodSync(file,0o600);
 const obj=await readManusApiKey();
 assert.equal(obj.status,"configured");
 const status=await getManusStatus();
 assert.equal(status.connection,"configured-unverified");
 assert.equal(JSON.stringify(status).includes(dummy),false);
});
test("MC_PREVIEW isolation refuses configured key and task initiation",async()=>{
 const prev=process.env.MC_PREVIEW;
 process.env.MC_PREVIEW="1";
 try {
   calls.length=0;
   assert.equal((await readManusApiKey()).status,"missing");
   assert.equal((await getManusStatus(mock)).connection,"pending-key");
   await assert.rejects(submitManusTask({prompt:"NEVER",acknowledgeManusCreditUsage:true},{fetcher:mock}),e=>reject(e,"MANUS_KEY_MISSING"));
   assert.equal(calls.length,0);
 } finally {
   if(prev===undefined)delete process.env.MC_PREVIEW;
   else process.env.MC_PREVIEW=prev;
 }
});
test("no spend acknowledgement blocks before network",async()=>{
 calls.length=0;
 await assert.rejects(submitManusTask({prompt:"test"}) ,e=>reject(e,"MANUS_SPEND_NOT_AUTHORIZED"));
 assert.equal(calls.length,0);
});
test("one explicitly confirmed task calls v2 with private visibility and server-side key",async()=>{
 calls.length=0;
 const result=await submitManusTask({prompt:"Build report",title:"Mock",acknowledgeManusCreditUsage:true},{fetcher:mock});
 assert.equal(result.task_id,"task_mock_a");assert.equal(calls.length,1);
 assert.equal(calls[0].url,"https://api.manus.ai/v2/task.create");
 assert.equal(calls[0].method,"POST");assert.equal(calls[0].header,dummy);
 const body=JSON.parse(calls[0].body);
 assert.equal(body.share_visibility,"private");assert.deepEqual(body.message.content,"Build report");
 assert.equal(JSON.stringify(result).includes(dummy),false);
});
test("GET status and results use documented v2 endpoints",async()=>{
 calls.length=0;
 const detail=await readManusTask("task_mock_a",{fetcher:mock});
 const messages=await readManusMessages("task_mock_a",{fetcher:mock});
 assert.equal((detail.task as {status:string}).status,"stopped");
 assert.equal((messages.messages as unknown[]).length,1);
 assert.equal(calls.length,2);
 assert.ok(calls[0].url.includes("/v2/task.detail?task_id=task_mock_a"));
 assert.ok(calls[1].url.includes("/v2/task.listMessages?task_id=task_mock_a"));
 assert.ok(calls.every(c=>c.method==="GET"));
});
test("untrusted task identifiers are rejected before network",async()=>{
 calls.length=0;
 await assert.rejects(readManusTask("../admin",{fetcher:mock}),e=>reject(e,"MANUS_INVALID_TASK_ID"));
 assert.equal(calls.length,0);
});
test("upstream 401 redacts key and never includes raw provider body",async()=>{
 const rejecting=async()=>new Response(JSON.stringify({ok:false,error:{message:dummy}}),{status:401});
 await assert.rejects(requestManusV2("user.me","GET",undefined,{fetcher:rejecting as typeof fetch}),err=>{
   assert.equal(String(err).includes(dummy),false);return reject(err,"MANUS_UPSTREAM_HTTP_ERROR");
 });
});
test("provider method allowlist rejects unwarranted verbs",async()=>{
 await assert.rejects(requestManusV2("task.detail","POST",{task_id:"t"},{fetcher:mock}),e=>reject(e,"MANUS_METHOD_NOT_ALLOWED"));
});
test("read-only user.me verifies authentication without task creation",async()=>{
 calls.length=0;
 const status=await getManusStatus(mock);
 assert.equal(status.connection,"connected");assert.equal(status.authVerified,true);
 assert.equal(calls.length,1);assert.equal(calls[0].url,"https://api.manus.ai/v2/user.me");
});
test("six existing ACF agent targets unchanged; Manus registered only as connector",()=>{
 assert.deepEqual(COCKPIT_AGENT_TARGETS.map(t=>t.apiAgentId),["claude-code","hermes","openclaw","agy","gemini","codex"]);
 assert.ok(!COCKPIT_AGENT_TARGETS.some(t=>String(t.id)==="manus"));
});
test("follow-up requires a fresh credit acknowledgement, same persistent provider task ID",async()=>{
 calls.length=0;
 await assert.rejects(sendManusFollowup("task_mock_a",{message:"continue"},{fetcher:mock}),
   e=>reject(e,"MANUS_SPEND_NOT_AUTHORIZED"));
 assert.equal(calls.length,0);
 const result=await sendManusFollowup("task_mock_a",
   {message:"continue",acknowledgeManusCreditUsage:true},{fetcher:mock});
 assert.equal(result.request_id,"mock_followup_req");
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,"https://api.manus.ai/v2/task.sendMessage");
 assert.equal(calls[0].method,"POST");
 assert.equal(JSON.parse(calls[0].body).task_id,"task_mock_a");
 assert.deepEqual(JSON.parse(calls[0].body).message,{content:"continue"});
});
test("invalid follow-up task id fails before network",async()=>{
 calls.length=0;
 await assert.rejects(sendManusFollowup("../bad",
   {message:"continue",acknowledgeManusCreditUsage:true},{fetcher:mock}),
   e=>reject(e,"MANUS_INVALID_TASK_ID"));
 assert.equal(calls.length,0);
});
test("missing Manus key fails closed for follow-up even after consent",async()=>{
 calls.length=0;
 const old=process.env.MC_PREVIEW;process.env.MC_PREVIEW="1";
 try {
   await assert.rejects(sendManusFollowup("task_mock_a",
     {message:"continue",acknowledgeManusCreditUsage:true},{fetcher:mock}),
     e=>reject(e,"MANUS_KEY_MISSING"));
   assert.equal(calls.length,0);
 } finally {
   if(old===undefined)delete process.env.MC_PREVIEW;
   else process.env.MC_PREVIEW=old;
 }
});
test.after(()=>{if(beforeProcessKey===undefined)delete process.env.MANUS_API_KEY_FILE;else process.env.MANUS_API_KEY_FILE=beforeProcessKey;rmSync(dir,{recursive:true,force:true});});
