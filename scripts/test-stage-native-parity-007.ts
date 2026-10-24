import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,chmod,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {changeCliAgentSession,getCliAgentSession,askCliAgent} from "../src/lib/cli-agents/api";
import {reconcileStageCliCandidates} from "../src/lib/acf/control-adapter";
import {createCliAgentSession,updateCliAgentSession} from "../src/lib/cli-agents/session-store";

test("isolated native profile enforced and prepared stage turns fail closed before provider",async()=>{
 const temp=await mkdtemp(path.join(tmpdir(),"mc007-"));
 const root=path.join(temp,".stage-achtergrond",".preview-native-home");
 const data=path.join(temp,"state");
 const saved=Object.fromEntries(["MC_PREVIEW","GAOS_STAGE_NATIVE_ISOLATED","GAOS_STAGE_NATIVE_ROOT",
 "HERMES_AGENT_BINARY","OPENCLAW_AGENT_BINARY","CLI_AGENT_SESSION_DATA_DIR","DATABASE_URL"].map(k=>[k,process.env[k]]));
 try{
  await mkdir(path.join(root,"hermes"),{recursive:true,mode:0o700});
  await mkdir(path.join(root,"openclaw"),{recursive:true,mode:0o700});
  await chmod(root,0o700);
  process.env.MC_PREVIEW="1";process.env.GAOS_STAGE_NATIVE_ISOLATED="1";
  process.env.GAOS_STAGE_NATIVE_ROOT=root;
  process.env.HERMES_AGENT_BINARY="/nonexistent/mc-preview-agents-disabled";
  process.env.OPENCLAW_AGENT_BINARY="/nonexistent/mc-preview-agents-disabled";
  process.env.CLI_AGENT_SESSION_DATA_DIR=data;delete process.env.DATABASE_URL;
  for(const agent of ["hermes","openclaw"] as const){
   const key="acf-werkplaats-parity-"+agent;
   const url="http://localhost/api/connectors/"+agent+"/session?sessionId="+key;
   const r=await changeCliAgentSession(new Request(url,{method:"POST",
     headers:{"content-type":"application/json"},body:JSON.stringify({action:"start"})}),agent);
   const refused=await r.json();
   assert.equal(r.status,409);
   assert.equal(refused.error,"STAGE_NATIVE_EXECUTABLE_DISABLED");
   assert.equal((await (await getCliAgentSession(new Request(url),agent)).json()).session,null);
   await createCliAgentSession(agent,key);
   await updateCliAgentSession(agent,key,{active:true,status:"prepared"});
   const send=await askCliAgent(new Request("http://localhost/api/connectors/"+agent+"/actions/ask",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({sessionId:key,prompt:"MUST NOT DISPATCH"})}),agent);
   assert.equal(send.status,409);
   assert.equal((await send.json()).error,"STAGE_NATIVE_FREE_TRANSPORT_NOT_VERIFIED");
  }
 } finally {
  for(const [k,v] of Object.entries(saved)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  await rm(temp,{recursive:true,force:true});
 }
});
test("LIVE-derived eligible records never make a STAGE native candidate",()=>{
 const p="^acf-werkplaats-[a-zA-Z0-9_-]+$";
 const live=["hermes","openclaw","claude-code","codex","gemini"].map(agentId=>({
  agentId,sessionId:"acf-werkplaats-"+agentId,status:"idle",active:true
 }));
 const stage=[{agentId:"codex",sessionId:"acf-werkplaats-codex",status:"prepared",active:true}];
 assert.deepEqual(reconcileStageCliCandidates(live,stage,p),stage);
 assert.deepEqual(reconcileStageCliCandidates(live,[],p),[]);
});
