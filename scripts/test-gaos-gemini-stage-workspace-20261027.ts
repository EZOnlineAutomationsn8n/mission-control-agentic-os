import assert from "node:assert/strict";
import { test } from "node:test";
import { geminiExecutionWorkspace, parseGeminiStreamEvents } from "../src/lib/cli-agents/gemini-runner";
import path from "node:path";

test("Gemini reads native workspace from the actual stage runtime rather than stored production cwd",()=>{
 const prev=process.env.MC_PREVIEW;
 try {
   process.env.MC_PREVIEW="1";
   const actual=geminiExecutionWorkspace("/workspace/projects/mission-control");
   assert.equal(actual,path.resolve(process.cwd()));
   assert.match(actual,/\/.stage-achtergrond$/);
   assert.notEqual(actual,"/workspace/projects/mission-control");
 }finally {
   if(prev===undefined)delete process.env.MC_PREVIEW;
   else process.env.MC_PREVIEW=prev;
 }
});
test("production Gemini workspace selection is unchanged",()=>{
 const prev=process.env.MC_PREVIEW;
 try {
   delete process.env.MC_PREVIEW;
   assert.equal(geminiExecutionWorkspace("/workspace/projects/mission-control"),
                "/workspace/projects/mission-control");
 }finally {
   if(prev!==undefined)process.env.MC_PREVIEW=prev;
 }
});


test("Gemini native error cannot be promoted to successful session output",()=>{
 const fatal=[JSON.stringify({type:"message",role:"assistant",content:"Partial content"}),
              JSON.stringify({type:"error",error:{message:"Provider failed"}})].join("\n");
 assert.throws(()=>parseGeminiStreamEvents(fatal,"native-stage-uuid"),/GEMINI_NATIVE_STREAM_ERROR/);
});
test("failed final result with text cannot masquerade as successful response",()=>{
 const fatal=JSON.stringify({type:"result",status:"failed",response:"All done!",error:{message:"Oops"}});
 assert.throws(()=>parseGeminiStreamEvents(fatal,"native-stage-uuid"),/GEMINI_NATIVE_STREAM_ERROR/);
});
test("auth error fails closed without exposing native stderr details",()=>{
 const fatal=JSON.stringify({type:"error",error:{message:"Login required; secret auth context"}} );
 assert.throws(()=>parseGeminiStreamEvents(fatal,"native-stage-uuid"),/GEMINI_NATIVE_AUTH_FAILURE/);
});
