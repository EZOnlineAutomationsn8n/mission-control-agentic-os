import assert from "node:assert/strict";
import { test } from "node:test";
import {parseRoomView,parseShellView,verifySavedRun,roomShellKey,ROOM_VIEW_KEY} from "../src/lib/acf/team-room-rehydration";

const B10A="RUN-TR-20261026-213351-B10A";
test("last explicitly selected historical ACF run and operator choices round-trip without transcript",()=>{
 const raw=JSON.stringify({version:1,runId:B10A,mode:"discuss",historyOpen:true,
  detailsOpen:true,operatorObjective:"unfinished objective",operatorSuccessCriterion:"done",
  draftChoices:{gemini:{selected:true,session:"acf-werkplaats-gemini",functions:"review"},
    codex:{selected:true,session:"acf-werkplaats-codex",functions:"audit"}},
  focusPreference:{role:"hermes",sequence:12}});
 const restored=parseRoomView(raw);
 assert.equal(restored?.runId,B10A);
 assert.equal(restored?.historyOpen,true);
 assert.equal(restored?.detailsOpen,true);
 assert.equal(Object.values(restored!.draftChoices).filter(x=>x.selected).length,2);
 assert.equal(restored?.focusPreference.role,"hermes");
 assert.ok(!Object.prototype.hasOwnProperty.call(restored??{},"messages"));
 assert.equal(verifySavedRun(B10A,[B10A],B10A),"VERIFIED");
});
test("local run preference cannot make a missing canonical run exist",()=>{
 assert.equal(verifySavedRun(B10A,["other-run"],B10A),"MISSING");
 assert.equal(verifySavedRun(B10A,[B10A],"other-run"),"MISMATCH");
 assert.equal(verifySavedRun(B10A,[],null),"MISSING");
});
test("malformed, stale version and giant persisted input fails closed",()=>{
 for(const value of ["not-json",JSON.stringify({version:2,runId:B10A}),"a".repeat(100001)])
   assert.equal(parseRoomView(value),null);
 assert.equal(parseRoomView(JSON.stringify({version:1,runId:"../api/unknown"}))?.runId,null);
 assert.equal(parseRoomView(JSON.stringify({version:1,runId:B10A,mode:"unknown"}))?.mode,"discuss");
});
test("slot positions and reading modes survive a reload without agent ownership",()=>{
 const key=roomShellKey(B10A);
 assert.equal(key,"mc.team-room.shell.v1."+B10A);
 assert.equal(ROOM_VIEW_KEY,"mc.team-room.operator-view.v1");
 const restored=parseShellView(JSON.stringify({version:1,visualSlotOffset:2,focusedId:"openclaw",readingSurface:"full"}));
 assert.equal(restored?.visualSlotOffset,2);
 assert.equal(restored?.focusedId,"openclaw");
 assert.equal(restored?.readingSurface,"full");
});
test("untrusted shell input cannot move slots beyond registry or inject an executable selection",()=>{
 const restored=parseShellView(JSON.stringify({version:1,visualSlotOffset:999,focusedId:23,readingSurface:"DROP"}));
 assert.equal(restored?.visualSlotOffset,0);
 assert.equal(restored?.focusedId,null);
 assert.equal(restored?.readingSurface,"live");
 assert.equal(parseShellView("{"),null);
});
