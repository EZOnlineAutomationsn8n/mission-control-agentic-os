import assert from "node:assert/strict";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { changeCliAgentSession } from "../src/lib/cli-agents/api";

test("Gemini stage session preparation creates only metadata, never a provider/model turn", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gaos-dpo-gemini-safe-"));
  const original = { preview: process.env.MC_PREVIEW, data: process.env.CLI_AGENT_SESSION_DATA_DIR,
    binary: process.env.GEMINI_AGENT_BINARY, db: process.env.DATABASE_URL };
  process.env.MC_PREVIEW = "1";
  process.env.CLI_AGENT_SESSION_DATA_DIR = dir;
  process.env.GEMINI_AGENT_BINARY = "/bin/false"; // a real native dispatch would fail
  delete process.env.DATABASE_URL;
  try {
    const key = "acf-werkplaats-gemini-offline-proof";
    const req = () => new Request("http://internal/api/connectors/gemini/session?sessionId="+key,{
      method: "POST", headers: {"content-type":"application/json"}, body: JSON.stringify({ action:"start" })
    });
    const r = await changeCliAgentSession(req(),"gemini");
    assert.equal(r.status,200);
    const answer = await r.json();
    assert.equal(answer.prepared,true);
    assert.equal(answer.modelCalls,0);
    assert.equal(answer.firstTurnByOperator,true);
    assert.equal(answer.authentication,"UNVERIFIED_UNTIL_NATIVE_TURN");
    assert.equal(answer.session.status,"prepared");
    assert.equal(answer.session.active,true);
    const registry=JSON.parse(await readFile(path.join(dir,"cli-agent-sessions.json"),"utf8"));
    assert.equal(registry["gemini:"+key].status,"prepared");
    const duplicate=await changeCliAgentSession(req(),"gemini");
    assert.equal(duplicate.status,200);
    const repeat=await duplicate.json();
    assert.equal(repeat.alreadyActive,true);
  } finally {
    for (const [key,value] of Object.entries({MC_PREVIEW:original.preview,
      CLI_AGENT_SESSION_DATA_DIR:original.data,GEMINI_AGENT_BINARY:original.binary,
      DATABASE_URL:original.db})) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
    await rm(dir,{recursive:true,force:true});
  }
});
