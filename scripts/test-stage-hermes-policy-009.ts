import {test} from "node:test";
import assert from "node:assert/strict";
import {hermesStagePinnedArgs} from "../src/lib/cli-agents/hermes-runner";
import {assessStageNativeFree,stageNativeExecWorkspace,
 type StageFreeEvidence} from "../src/lib/cli-agents/stage-native-free-gate";
import {mkdtemp,mkdir,chmod,rm,symlink} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
const positive:StageFreeEvidence={
 stage:true,stageSession:true,profileIsolated:true,nativeModelExact:true,
 providerExact:true,fallbackEmpty:true,nativeToolsDisabled:true,
 stageCredential:true,transportIsolated:true,catalogTextFree:true,
 extraToolFeesDisabled:true
};
test("Hermes stage CLI leaves primary/provider/fallbacks to native operator config",()=>{
 assert.deepEqual(hermesStagePinnedArgs(),["--max-turns","1"]);
});
test("Hermes existing profile remains source of model selection; fee diagnostics do not block",()=>{
 assert.equal(assessStageNativeFree({...positive,fallbackEmpty:false,
   catalogTextFree:false,nativeToolsDisabled:false,extraToolFeesDisabled:false}).canSend,true);
 assert.equal(assessStageNativeFree({...positive,transportIsolated:false}).canSend,false);
 assert.equal(assessStageNativeFree({...positive,stageCredential:false}).canSend,false);
});
test("Native stage execution never follows legacy project-root cwd",async()=>{
 const folder=await mkdtemp(path.join(tmpdir(),"gaos-native-cwd-"));
 const root=path.join(folder,".stage-achtergrond",".preview-native-home");
 const old={preview:process.env.MC_PREVIEW,isolated:process.env.GAOS_STAGE_NATIVE_ISOLATED,
   root:process.env.GAOS_STAGE_NATIVE_ROOT};
 try{
  await mkdir(path.join(root,"hermes","workspace-mission-control"),{recursive:true,mode:0o700});
  await chmod(root,0o700);await chmod(path.join(root,"hermes"),0o700);
  const cwd=path.join(root,"hermes","workspace-mission-control");
  await chmod(cwd,0o700);
  process.env.MC_PREVIEW="1";process.env.GAOS_STAGE_NATIVE_ISOLATED="1";
  process.env.GAOS_STAGE_NATIVE_ROOT=root;
  assert.equal(await stageNativeExecWorkspace("hermes"),cwd);
  assert.notEqual(cwd,"/workspace/projects/mission-control");
  await rm(cwd,{recursive:true});
  await symlink("/workspace/projects/mission-control",cwd);
  await assert.rejects(stageNativeExecWorkspace("hermes"),/NATIVE_STAGE_WORKSPACE_ISOLATION_UNVERIFIED/);
  process.env.MC_PREVIEW="0";
  await assert.rejects(stageNativeExecWorkspace("hermes"),/NATIVE_STAGE_WORKSPACE_MODE_UNVERIFIED/);
 }finally{
  if(old.preview===undefined)delete process.env.MC_PREVIEW;else process.env.MC_PREVIEW=old.preview;
  if(old.isolated===undefined)delete process.env.GAOS_STAGE_NATIVE_ISOLATED;else process.env.GAOS_STAGE_NATIVE_ISOLATED=old.isolated;
  if(old.root===undefined)delete process.env.GAOS_STAGE_NATIVE_ROOT;else process.env.GAOS_STAGE_NATIVE_ROOT=old.root;
  await rm(folder,{recursive:true,force:true});
 }
});
