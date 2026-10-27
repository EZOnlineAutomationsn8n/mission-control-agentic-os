import assert from "node:assert/strict";
import { test } from "node:test";
import { stageCliProfileEnvironment } from "../src/lib/cli-agents/stage-cli-profile";
import path from "node:path";

test("Gemini and Codex native stage CLI HOME is under existing preview pool",async()=>{
 const previous=process.env.MC_PREVIEW;process.env.MC_PREVIEW="1";
 try{
  for(const agent of ["gemini","codex"] as const){
   const env=await stageCliProfileEnvironment(agent,{...process.env,HOME:"/root",XDG_CONFIG_HOME:"/root/.config"});
   const expected=path.join(process.cwd(),".preview-native-home",agent);
   assert.equal(env.HOME,expected);
   assert.equal(env.XDG_CONFIG_HOME,expected);
   assert.equal(env.XDG_CACHE_HOME,expected);
   assert.equal(env.XDG_DATA_HOME,expected);
   if(agent==="codex")assert.equal(env.CODEX_HOME,path.join(expected,".codex"));
  }
 }finally{if(previous===undefined)delete process.env.MC_PREVIEW;else process.env.MC_PREVIEW=previous}
});
test("LIVE unchanged when preview is off",async()=>{
 const previous=process.env.MC_PREVIEW;delete process.env.MC_PREVIEW;
 try{assert.equal((await stageCliProfileEnvironment("codex",{...process.env,HOME:"/root",CODEX_HOME:"/root/.codex"})).HOME,"/root")}
 finally{if(previous!==undefined)process.env.MC_PREVIEW=previous}
});
test("no profile mutation or new credential required by the isolated env resolver",async()=>{
 const previous=process.env.MC_PREVIEW;process.env.MC_PREVIEW="1";
 try{
  const env=await stageCliProfileEnvironment("claude-code",{...process.env,HOME:"/not-stage"});
  assert.ok(env.HOME!.endsWith("/.preview-native-home/claude-code"));
  assert.notEqual(env.HOME,"/not-stage");
 }finally{if(previous===undefined)delete process.env.MC_PREVIEW;else process.env.MC_PREVIEW=previous}
});
