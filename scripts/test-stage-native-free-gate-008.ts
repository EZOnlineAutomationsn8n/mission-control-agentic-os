import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,mkdir,rm,readFile,stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {assessStageNativeFree,type StageFreeEvidence} from "../src/lib/cli-agents/stage-native-free-gate";
import {stageNativeKeyPath,saveStageNativeKey,stageNativeKeyPresent} from "../src/lib/cli-agents/stage-native-secret";
import {POST} from "../src/app/api/connectors/native-stage/setup/route";
const valid:StageFreeEvidence={
  stage:true,stageSession:true,profileIsolated:true,nativeModelExact:true,
  providerExact:true,fallbackEmpty:true,nativeToolsDisabled:true,
  stageCredential:true,transportIsolated:true,catalogTextFree:true,
  extraToolFeesDisabled:true,
};
test("Native free transport green condition is ONLY a completed strict proof",()=>{
 assert.equal(assessStageNativeFree(valid).canSend,true);
});
test("Native free transport denies all unsafe branches",()=>{
 const samples:[keyof StageFreeEvidence,string][]=[
  ["stage","NOT_ISOLATED_STAGE"],
  ["stageSession","STAGE_SESSION_ID_INVALID"],
  ["profileIsolated","NATIVE_PROFILE_UNVERIFIED"],
  ["nativeModelExact","STAGE_PROVIDER_MODEL_MISMATCH"],
  ["providerExact","STAGE_PROVIDER_MODEL_MISMATCH"],
  ["fallbackEmpty","STAGE_FALLBACK_NOT_EMPTY"],
  ["nativeToolsDisabled","NATIVE_TOOLS_OR_FEES_UNVERIFIED"],
  ["extraToolFeesDisabled","NATIVE_TOOLS_OR_FEES_UNVERIFIED"],
  ["stageCredential","STAGE_NATIVE_KEY_MISSING"],
  ["transportIsolated","STAGE_NATIVE_TRANSPORT_UNAVAILABLE"],
  ["catalogTextFree","OPENROUTER_ENDPOINT_PRICE_NOT_VERIFIED"],
 ];
 for(const [k,code] of samples){
  const v={...valid,[k]:false};
  assert.deepEqual(assessStageNativeFree(v),{canSend:false,code},k);
 }
});
test("Stage OpenRouter credential never writes to production, no overwrites or key echo",async()=>{
 const root=await mkdtemp(path.join(tmpdir(),"gaos008-"));
 const dir=path.join(root,".stage-achtergrond","data");
 const prev=Object.fromEntries(["MC_PREVIEW","CLI_AGENT_SESSION_DATA_DIR"].map(k=>[k,process.env[k]]));
 const dummy="sk-or-v1-"+"z".repeat(52);
 try{
  process.env.MC_PREVIEW="1";process.env.CLI_AGENT_SESSION_DATA_DIR=dir;
  assert.equal(stageNativeKeyPath(),path.join(dir,"secrets","native-stage-openrouter-key"));
  assert.equal(await stageNativeKeyPresent(),false);
  assert.equal(await saveStageNativeKey("bad-key"),"OPENROUTER_STAGE_KEY_FORMAT_INVALID");
  const denied=await POST(new Request("http://localhost/api/connectors/native-stage/setup?agent=openclaw&action=save",{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({key:dummy})}));
  assert.equal(denied.status,403);
  assert.equal(await stageNativeKeyPresent(),false);
  await mkdir(dir,{recursive:true,mode:0o700});
  assert.equal(await saveStageNativeKey(dummy),"STAGE_NATIVE_KEY_STORED");
  assert.equal(await stageNativeKeyPresent(),true);
  const p=stageNativeKeyPath()!;
  const st=await stat(p);
  assert.equal(st.mode&0o077,0);
  assert.equal(await readFile(p,"utf8"),dummy);
  assert.equal(await saveStageNativeKey(dummy),"STAGE_KEY_ALREADY_CONFIGURED_NO_SILENT_ROTATION");
  process.env.CLI_AGENT_SESSION_DATA_DIR=path.join(root,"production-data");
  assert.equal(stageNativeKeyPath(),null);
  assert.equal(await saveStageNativeKey(dummy),"STAGE_SECRET_HOME_UNAVAILABLE");
 }finally{
  for(const [k,v] of Object.entries(prev)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
  await rm(root,{recursive:true,force:true});
 }
});
