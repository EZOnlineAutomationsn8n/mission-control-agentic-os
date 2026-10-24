import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";

test("Codex authenticating with ChatGPT subscription is distinguishable from metered API credentials",async()=>{
 const {codexUsesChatGptSubscriptionAuth}=await import("../src/lib/cli-agents/api");
 assert.equal(codexUsesChatGptSubscriptionAuth("Logged in using ChatGPT\n"),true);
 for(const text of ["Not logged in","Logged in using API key",
   "Logged in using ChatGPT\nAPI key payment enabled",
   "Logged in using ChatGPT\nOpenAI_API_KEY=present",""]){
   assert.equal(codexUsesChatGptSubscriptionAuth(text),false);
 }
});
test("Gemini stage Start is fail-closed without proven zero-cost and creates no session",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"gaos-gemini-cost-"));
 const save={preview:process.env.MC_PREVIEW,dir:process.env.CLI_AGENT_SESSION_DATA_DIR};
 try{
  process.env.MC_PREVIEW="1";process.env.CLI_AGENT_SESSION_DATA_DIR=root;
  const {changeCliAgentSession,getCliAgentSession}=await import("../src/lib/cli-agents/api");
  const url="http://localhost/api/connectors/gemini/session?sessionId=acf-werkplaats-gemini";
  const res=await changeCliAgentSession(new Request(url,{method:"POST",
   headers:{"content-type":"application/json"},body:JSON.stringify({action:"start"})}),"gemini");
  assert.equal(res.status,409);
  assert.equal((await res.json()).error,"GEMINI_ZERO_COST_AUTH_AND_MODEL_UNVERIFIED");
  assert.equal((await (await getCliAgentSession(new Request(url),"gemini")).json()).session,null);
 }finally{
  if(save.preview===undefined)delete process.env.MC_PREVIEW;else process.env.MC_PREVIEW=save.preview;
  if(save.dir===undefined)delete process.env.CLI_AGENT_SESSION_DATA_DIR;else process.env.CLI_AGENT_SESSION_DATA_DIR=save.dir;
  await rm(root,{recursive:true,force:true});
 }
});
