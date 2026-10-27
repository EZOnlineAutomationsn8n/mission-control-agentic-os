import assert from "node:assert/strict";
import {test} from "node:test";
import {deriveClaudeFccOperatorState, type ClaudeFccOperatorInput} from "../src/lib/acf/claude-fcc-operator-view";
const base:ClaudeFccOperatorInput={
 fcc:"connected",nativeVersion:null,stageSession:null,acfSession:null,canJoinNow:false,teamPaused:false
};
test("Live ERROR plus independent Werkplaats PREPARED never becomes READY",()=>{
 const x=deriveClaudeFccOperatorState({...base,
  stageSession:{status:"prepared",active:true,hasNativeId:true,firstTurnStored:false},
  acfSession:{status:"error",verdict:"EXCLUDED_ERROR"}});
 assert.equal(x.kind,"ERROR");assert.equal(x.next,"INSPECT_ERROR");
 assert.equal(x.acfReady,false);
});
test("prepared first turn stays operator-only; FCC connected cannot make it READY",()=>{
 const x=deriveClaudeFccOperatorState({...base,stageSession:{status:"prepared",active:true,hasNativeId:true,firstTurnStored:false}});
 assert.equal(x.kind,"PREPARED");assert.equal(x.next,"OPEN_EXISTING_PREPARED");
});
test("native first turn, eligible ACF, and FCC each required for READY",()=>{
 const good:ClaudeFccOperatorInput={...base,
  nativeVersion:"2.1.0",canJoinNow:true,
  stageSession:{status:"idle",active:true,hasNativeId:true,firstTurnStored:true},
  acfSession:{status:"idle",verdict:"ELIGIBLE"}};
 assert.equal(deriveClaudeFccOperatorState(good).kind,"READY");
 for(const edit of [{nativeVersion:null},{canJoinNow:false},{fcc:"unknown" as const},
   {stageSession:{...good.stageSession!,firstTurnStored:false}}]){
  assert.notEqual(deriveClaudeFccOperatorState({...good,...edit}).kind,"READY");
 }
});
test("ACF team pause is distinguished from native process error",()=>{
 const x=deriveClaudeFccOperatorState({...base,teamPaused:true,acfSession:{status:"idle",verdict:"ELIGIBLE"}});
 assert.equal(x.kind,"PAUSED");assert.equal(x.next,"SHOW_RESUME");
});
test("unknown, error, stopped and running never auto retry",()=>{
 for(const state of ["error","running","stopped"]){
  const x=deriveClaudeFccOperatorState({...base,stageSession:{status:state,active:false,hasNativeId:true,firstTurnStored:false}});
  assert.notEqual(x.kind,"READY");assert.equal(x.acfReady,false);
 }
 assert.equal(deriveClaudeFccOperatorState(base).kind,"UNKNOWN");
});
test("obsolete free-only recovery gate absent; legacy FCC product names are not price gates",async()=>{
 const {readFileSync}=await import("node:fs");
 const s=readFileSync("src/lib/acf/werkplaats-session-recovery.ts","utf8");
 assert.doesNotMatch(s,/bewezen gratis SDK\/FCC-binding/);
 assert.match(s,/zonder native-history reset of aanvullende cost\/free-only gate/);
});
test("prominent user control is read-only and anchored in Mijn team",async()=>{
 const {readFileSync}=await import("node:fs");
 const s=readFileSync("src/components/team-room/TeamRoomView.tsx","utf8");
 assert.match(s,/data-testid="team-room-claude-fcc-recovery"/);
 assert.match(s,/data-testid="claude-fcc-open-session"/);
 assert.match(s,/data-testid="claude-fcc-inspect-error"/);
 const panel=s.slice(s.indexOf("function ClaudeFccStatusPanel"),s.indexOf("export function TeamRoomView"));
 assert.match(panel,/GET only; no new session/);
 assert.doesNotMatch(panel,/method:\s*"POST"|team-resume\s*\(/);
});
