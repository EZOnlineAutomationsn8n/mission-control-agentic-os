import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveEvidenceGroupReport } from "../src/lib/acf/evidence-group-report";
import type { AcfMessageReadModel, AcfTeamRoomRun } from "../src/lib/acf/types";

const people = [
  {role:"hermes",agentId:"hermes",sessionRef:"acf-werkplaats-hermes"},
  {role:"openclaw",agentId:"openclaw",sessionRef:"acf-werkplaats-openclaw"},
] as AcfTeamRoomRun["participants"];

function message(role:"hermes"|"openclaw",seq:number,through:number|null): AcfMessageReadModel {
 return {
  messageId:"M"+seq,kind:"ANSWER",from:role,to:"OPERATOR",
  body:"Onafhankelijke bevinding "+role,inReplyTo:"Q1",answered:true,sequence:seq,
  at:"2026-10-26T21:59:00Z",origin:{
   agentId:role,sessionRef:"acf-werkplaats-"+role,conversationRef:"NATIVE",
   turnId:"T"+seq,contextThroughSequence:through,basedOnSequence:through,
   participantId:role,via:"MC",responseSha256:"evidence",
  }
 };
}
function report(messages:AcfMessageReadModel[],participants=people){
 return deriveEvidenceGroupReport({
   runId:"RUN-TR-20261026-213351-B10A",runState:"ACTIVE",goal:"Collaborate",
   messages,participants,replayMatchesRecord:true,
   teamView:{replay_matches_record:true}
 } as unknown as AcfTeamRoomRun);
}
test("the real-like Hermes then OpenClaw origin upper bound cannot certify isolated research",()=>{
 const r=report([message("hermes",11,10),message("openclaw",12,11)]);
 assert.equal(r.initialResearch.verdict,"CONTEXT_BARRIER_NOT_PROVEN");
 assert.equal(r.initialResearch.parallelExecutionProven,false);
 assert.deepEqual(r.initialResearch.firstTurns.map(x=>[x.role,x.sequence,x.contextThroughSequence]),[
   ["hermes",11,10],["openclaw",12,11],
 ]);
});
test("non-overlapping context bounds still cannot certify parallel execution",()=>{
 const r=report([message("hermes",11,10),message("openclaw",12,10)]);
 assert.equal(r.initialResearch.verdict,"ISOLATION_COMPATIBLE_NOT_PROVEN");
 assert.equal(r.initialResearch.parallelExecutionProven,false);
});
test("unknown context-through fields result in insufficient evidence, never independence proof",()=>{
 const r=report([message("hermes",11,null),message("openclaw",12,11)]);
 assert.equal(r.initialResearch.verdict,"INSUFFICIENT_EVIDENCE");
});
test("single native turn and operator-only messages do not prove multiple researchers",()=>{
 const r=report([message("hermes",11,10)]);
 assert.equal(r.initialResearch.verdict,"INSUFFICIENT_EVIDENCE");
 assert.equal(r.initialResearch.firstTurns.length,1);
});
test("tampered cross-session origin is excluded rather than treated as a native participant",()=>{
 const bad=message("openclaw",12,11);
 bad.origin!.sessionRef="wrong_session";
 const r=report([message("hermes",11,10),bad]);
 assert.equal(r.initialResearch.verdict,"INSUFFICIENT_EVIDENCE");
});
test("operator claims cannot create participant proof",()=>{
 const operator=message("openclaw",12,11);
 operator.from="OPERATOR";
 const r=report([message("hermes",11,10),operator]);
 assert.equal(r.initialResearch.firstTurns.length,1);
 assert.equal(r.initialResearch.parallelExecutionProven,false);
});
