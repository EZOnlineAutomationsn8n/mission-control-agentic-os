import assert from "node:assert/strict";
import test from "node:test";
import { deriveEvidenceGroupReport } from "../src/lib/acf/evidence-group-report";
import type { AcfMessageReadModel, AcfTeamRoomRun } from "../src/lib/acf/types";

const who = ["claude-code", "hermes", "openclaw"] as const;
type Role = typeof who[number];
function msg(seq: number, from: Role | "OPERATOR", to: Role | "OPERATOR", body: string,
  reply: string | null = null, withEvidence = true): AcfMessageReadModel {
  return {messageId:"M"+seq,sequence:seq,kind:"NOTE",from,to,body,inReplyTo:reply,
    answered:false,at:null,origin:!withEvidence||from==="OPERATOR"?null:{
      via:"PARTICIPANT_DIALOGUE",turnId:"T"+seq,participantId:from,
      agentId:from,sessionRef:"acf-werkplaats-"+from,
      contextThroughSequence:seq-1,basedOnSequence:seq-1,
      conversationRef:"conv-"+seq,responseSha256:"sha-"+seq,
    },
  };
}
function run(messages:AcfMessageReadModel[],verified=true):AcfTeamRoomRun {
  return {
    runId:"RUN-OFFLINE-ONLY",runState:"ACTIVE",goal:"Proefproject schaalbaar maken",
    messages,participants:who.map(role=>({role,agentId:role,sessionRef:"acf-werkplaats-"+role,
      participantId:role,identityVerificationState:"CLAIMED"})),
    replayMatchesRecord:verified,teamView:{replay_matches_record:verified} as AcfTeamRoomRun["teamView"],
  } as AcfTeamRoomRun;
}
test("deterministic three-agent fixture preserves every message, cross-links, dispute, revision and traceable conclusions",()=>{
 const scripted=[
  msg(1,"OPERATOR","claude-code","Wat is ons plan?"),
  msg(2,"claude-code","hermes","STANDPUNT: Start met het eenvoudige migratieplan."),
  msg(3,"hermes","claude-code","BEZWAAR: Zonder rollback is het oorspronkelijke plan riskant.","M2"),
  msg(4,"openclaw","hermes","AKKOORD: Het bezwaar over rollback is terecht.","M3"),
  msg(5,"claude-code","openclaw","HERZIEN: Ik wijzig mijn voorstel: eerst rollbackbewijs, daarna migratie.","M3"),
  msg(6,"hermes","openclaw","OPEN: Werkt de isolatietest ook mobiel?","M5"),
  msg(7,"openclaw","claude-code","CONCLUSIE: De mobiele proef is nog niet uitgevoerd; niet releasen.","M6"),
  msg(8,"claude-code","hermes","AKKOORD: We mogen niet releasen zonder die proef.","M7"),
  msg(9,"hermes","claude-code","CONCLUSIE: Er is voorlopig een onderzoeksrichting, geen unaniem eindbesluit.","M8"),
 ];
 const report=deriveEvidenceGroupReport(run(scripted));
 assert.equal(report.sourceMessages.length,9);
 assert.deepEqual(report.sourceMessages.map(v=>v.messageId),scripted.map(v=>v.messageId));
 assert.deepEqual(report.participantTurns.map(v=>v.turns),[3,3,2]);
 assert.equal(report.peerResponses.length,8);
 assert.deepEqual([...new Set(report.peerResponses.map(v=>v.from+"->"+v.to))].sort(),
   ["claude-code->hermes","claude-code->openclaw","hermes->claude-code",
     "hermes->openclaw","openclaw->claude-code","openclaw->hermes"].sort());
 assert.equal(report.evidence.filter(e=>e.kind==="OBJECTION")[0].messageId,"M3");
 assert.equal(report.evidence.filter(e=>e.kind==="REVISION")[0].messageId,"M5");
 assert.equal(report.evidence.filter(e=>e.kind==="OPEN")[0].messageId,"M6");
 assert.deepEqual(report.evidence.filter(e=>e.kind==="CONCLUSION").map(e=>e.messageId),["M7","M9"]);
 assert.equal(report.evidence.filter(e=>e.kind==="AGREEMENT").length,2);
 assert.ok(report.evidence.every(e=>e.agentId && e.sessionRef && e.conversationRef));
 assert.equal(report.snapshotReplayVerified,true);
 assert.equal(report.participantFullContextVerified,false);
 assert.equal(report.consensusStatus,"NOT_PROVEN");
});
test("old A to B to C relay is not upgraded to substantive collaboration by turns or tag-free prose",()=>{
 const report=deriveEvidenceGroupReport(run([
  msg(1,"claude-code","hermes","Ik geef door aan Hermes."),
  msg(2,"hermes","openclaw","Ik geef door aan OpenClaw."),
  msg(3,"openclaw","claude-code","Ontvangen."),
 ]));
 assert.equal(report.peerResponses.length,3);
 assert.equal(report.evidence.length,0);
 assert.equal(report.consensusStatus,"NOT_PROVEN");
 assert.equal(report.participantFullContextVerified,false);
});
test("operator suggestions and unaudited replies never become agent consensus or attributed evidence",()=>{
 const report=deriveEvidenceGroupReport(run([
  msg(1,"OPERATOR","claude-code","AKKOORD: Iedereen is het eens."),
  msg(2,"hermes","openclaw","CONCLUSIE: Klaar en goedgekeurd.",null,false),
  msg(3,"claude-code","hermes","BEZWAAR: Testbewijs ontbreekt."),
 ],false));
 assert.deepEqual(report.evidence.map(e=>e.kind),["OBJECTION"]);
 assert.equal(report.snapshotReplayVerified,false);
 assert.ok(report.caveats.some(x=>x.includes("niet volledig bevestigd")));
 assert.equal(report.consensusStatus,"NOT_PROVEN");
});
test("repeated windows and earlier non-recipient messages remain visible; source never silently truncated",()=>{
 const x=Array.from({length:34},(_,i)=>msg(i+1,who[i%3],who[(i+2)%3],"Bericht "+i));
 const report=deriveEvidenceGroupReport(run(x));
 assert.equal(report.sourceMessages.length,34);
 assert.equal(report.sourceMessages[0].messageId,"M1");
 assert.equal(report.sourceMessages[33].messageId,"M34");
 assert.equal(report.participantFullContextVerified,false);
});
test("a statement without a complete native-origin proof is not included as a substantive claim",()=>{
 const m=msg(1,"claude-code","hermes","AKKOORD: Eens");
 m.origin!.conversationRef=null;
 const report=deriveEvidenceGroupReport(run([m]));
 assert.equal(report.evidence.length,0);
 assert.equal(report.participantTurns[0].turns,0);
});
