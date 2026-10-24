import assert from "node:assert/strict";
import {test} from "node:test";
import {stageManusKeyPath, validateWerkplaatsOperator, writeStageManusSecret} from "../src/lib/connectors/live/manus-stage-setup";
import {readManusApiKey} from "../src/lib/connectors/live/manus-v2";
const origPreview=process.env.MC_PREVIEW;
const origDir=process.env.CLI_AGENT_SESSION_DATA_DIR;
test("preview key has no production fallback",async()=>{
  process.env.MC_PREVIEW="1";delete process.env.CLI_AGENT_SESSION_DATA_DIR;
  assert.equal(stageManusKeyPath(),null);
  assert.equal((await readManusApiKey()).status,"missing");
  assert.equal(await writeStageManusSecret("not-a-real-key-01234567890"),"STAGE_SECRET_HOME_UNAVAILABLE");
});
test("only certified stage data tree accepted",()=>{
  process.env.MC_PREVIEW="1";process.env.CLI_AGENT_SESSION_DATA_DIR="/workspace/projects/mission-control/data";
  assert.equal(stageManusKeyPath(),null);
});
test("origin and Basic account gates fail closed",async()=>{
  process.env.MC_PREVIEW="1";
  const base="https://mc.vireonhq.cloud:8443/api/connectors/manus/setup";
  const noAuth=new Request(base,{method:"POST",headers:{origin:"https://mc.vireonhq.cloud:8443","sec-fetch-site":"same-origin"}});
  assert.equal(await validateWerkplaatsOperator(noAuth),"WORKPLACE_LOGIN_REQUIRED");
  const wrongOrigin=new Request(base,{method:"POST",headers:{origin:"https://evil.invalid",authorization:"Basic ZGVubmlzOnBhc3N3b3Jk","sec-fetch-site":"same-origin"}});
  assert.equal(await validateWerkplaatsOperator(wrongOrigin),"ORIGIN_MISMATCH");
});
test("preview cannot read regular production secret",async()=>{
  process.env.MC_PREVIEW="1";process.env.CLI_AGENT_SESSION_DATA_DIR="/workspace/projects/mission-control/.stage-achtergrond/data";
  assert.equal(stageManusKeyPath(),"/workspace/projects/mission-control/.stage-achtergrond/data/secrets/manus-stage-api-key");
  assert.equal((await readManusApiKey()).status,"missing");
});
test("clean env",()=>{if(origPreview===undefined)delete process.env.MC_PREVIEW;else process.env.MC_PREVIEW=origPreview;
  if(origDir===undefined)delete process.env.CLI_AGENT_SESSION_DATA_DIR;else process.env.CLI_AGENT_SESSION_DATA_DIR=origDir;
});
