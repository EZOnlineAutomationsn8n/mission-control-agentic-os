import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";

const root = await mkdtemp(path.join(tmpdir(), "mc-semantic-vision-"));
delete process.env.DATABASE_URL;
process.env.ATTACHMENT_DATA_DIR = root;
const { storeAttachments } = await import("../src/lib/attachments/store");
const { verifyLocalVisionModel, runLocalSemanticVision } = await import("../src/lib/attachments/local-semantic-vision");
test.after(async () => { await rm(root,{recursive:true,force:true}); });

async function pixelFixture(left: string, right: string) {
  const png = await sharp({create:{width:120,height:80,channels:3,background:left}})
    .composite([{input:{create:{width:60,height:80,channels:3,background:right}},top:0,left:60}])
    .png().toBuffer();
  return new File([new Uint8Array(png)],"picture.png",{type:"image/png"});
}

test("disabled local model rejects image without any inference or network request", async () => {
  delete process.env.MC_LOCAL_VISION_ENABLED;
  delete process.env.MC_LOCAL_VISION_MODEL;
  let calls = 0;
  const fetchFn = (async () => { calls++; throw new Error("must not be reached"); }) as typeof fetch;
  await assert.rejects(verifyLocalVisionModel(fetchFn), /VISION_MODEL_NOT_VERIFIED/);
  assert.equal(calls,0);
});

test("installed text-only Ollama model is not accepted as semantic vision", async () => {
  process.env.MC_LOCAL_VISION_ENABLED="1";
  process.env.MC_LOCAL_VISION_MODEL="qwen2.5:3b";
  const calls: string[] = [];
  const fetchFn = (async (url: string | URL | Request) => {
    const p = new URL(String(url)).pathname;
    calls.push(p);
    return Response.json(p === "/api/tags" ? {models:[{name:"qwen2.5:3b"}]} : {capabilities:["completion"]});
  }) as typeof fetch;
  await assert.rejects(verifyLocalVisionModel(fetchFn), /VISION_MODEL_NOT_VISION_CAPABLE/);
  assert.deepEqual(calls,["/api/tags","/api/show"]);
});

test("uninstalled model rejects before image bytes or chat are transmitted", async () => {
  process.env.MC_LOCAL_VISION_ENABLED="1";
  process.env.MC_LOCAL_VISION_MODEL="not-installed:latest";
  let calls=0;
  const fetchFn = (async () => { calls++;return Response.json({models:[]}); }) as typeof fetch;
  await assert.rejects(verifyLocalVisionModel(fetchFn), /VISION_MODEL_NOT_INSTALLED/);
  assert.equal(calls,1);
});

test("MOCK TRANSPORT ONLY: real image bytes sent to fixed loopback /api/chat and local tool is labeled truthfully", async () => {
  process.env.MC_LOCAL_VISION_ENABLED="1";
  process.env.MC_LOCAL_VISION_MODEL="fixture-vision:latest";
  const [image] = await storeAttachments({agentId:"openclaw",sessionId:"fixture-vision",files:[await pixelFixture("#ff0000","#0000ff")]});
  const calls: Array<{path:string;method?:string}> = [];
  let inspectedImageBytes = false;
  const fakeOllama = (async (url: string | URL | Request, opts?: RequestInit) => {
    const u = new URL(String(url));
    assert.equal(u.origin,"http://127.0.0.1:11434");
    assert.equal(opts?.redirect,"error");
    calls.push({path:u.pathname,method:opts?.method});
    if (u.pathname==="/api/tags") return Response.json({models:[{name:"fixture-vision:latest"}]});
    if (u.pathname==="/api/show") return Response.json({capabilities:["vision","completion"]});
    if (u.pathname==="/api/chat") {
      const data=JSON.parse(String(opts?.body));
      assert.equal(data.model,"fixture-vision:latest");
      assert.equal(data.stream,false);
      assert.equal(data.messages.length,1);
      assert.equal(data.messages[0].images.length,1);
      const imageData=Buffer.from(data.messages[0].images[0],"base64");
      const decoded=sharp(imageData);
      const meta=await decoded.metadata();
      assert.equal(meta.width,120);
      assert.equal(meta.height,80);
      const pixels=await decoded.removeAlpha().raw().toBuffer({resolveWithObject:true});
      const color=(x:number,y:number)=>{const i=(y*120+x)*pixels.info.channels;return Array.from(pixels.data.subarray(i,i+3));};
      const l=color(18,20),r=color(110,20);
      assert.ok(l[0]>200&&l[2]<90);
      assert.ok(r[2]>190&&r[0]<100);
      inspectedImageBytes=true;
      return Response.json({model:"fixture-vision:latest",message:{content:"FIXTURE_RESPONSE_ONLY_NOT_A_REAL_SEMANTIC_MODEL"}});
    }
    throw new Error("unexpected request path");
  }) as typeof fetch;
  const verified=await verifyLocalVisionModel(fakeOllama);
  const answer=await runLocalSemanticVision({prompt:"What objects are in the photograph?",attachments:[image],sessionId:"fixture-vision",agentId:"openclaw",verified,fetchFn:fakeOllama});
  assert.ok(inspectedImageBytes);
  assert.deepEqual(calls.map((x)=>x.path),["/api/tags","/api/show","/api/chat"]);
  assert.equal(answer.text,"FIXTURE_RESPONSE_ONLY_NOT_A_REAL_SEMANTIC_MODEL");
  assert.equal(answer.agentSessionId,null);
  assert.match(answer.agentIdentity??"",/not native agent CLI/);
  assert.match(answer.responseProvenance??"",/NOT_OPENCLAW_OR_CLAUDE_CLI/);
});

test("local-only model route forbids network fallback and rejects misconfiguration",async()=>{
  process.env.MC_LOCAL_VISION_ENABLED="1";
  process.env.MC_LOCAL_VISION_MODEL="https://paid.provider.example/vision";
  let calls=0;
  await assert.rejects(verifyLocalVisionModel((async()=>{calls++;return Response.json({models:[]})}) as typeof fetch),/VISION_MODEL_NOT_VERIFIED/);
  assert.equal(calls,0);
});
