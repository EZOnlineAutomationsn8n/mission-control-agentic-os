import assert from "node:assert/strict";
import { test } from "node:test";
import { safeToStartCollaborationAfterReplies } from "../src/lib/acf/continuous-room-policy";
import type { AcfTeamViewV1 } from "../src/lib/acf/types";

function view(changes: Record<string,unknown>={}): AcfTeamViewV1 {
  return {
    schema:2, view_version:1, run_id:"run", run_status:"ACTIVE", team_run_completed:false,
    state_hash:"hash",last_seq:11,replay_matches_record:true,next_safe_action:null,reentry_point:null,
    participants:[{role:"hermes"},{role:"openclaw"}],turns:[],in_flight:null,loop:null,acceptance:null,completion:{},
    intervention:{open:null,count:0,history:[]},collaboration:null,...changes
  } as AcfTeamViewV1;
}
const selected=["hermes","openclaw"];
test("one-command collaboration uses the exact same two bound participants",()=>{
  assert.equal(safeToStartCollaborationAfterReplies(view(),selected),true);
});
test("no collaboration dispatch with one agent, duplicate, or an unbound session",()=>{
  for (const members of [["hermes"],["hermes","hermes"],["hermes","codex"]]) {
    assert.equal(safeToStartCollaborationAfterReplies(view(),members),false);
  }
});
test("never run while ACF retains an unconfirmed native turn",()=>{
  assert.equal(safeToStartCollaborationAfterReplies(view({in_flight:{role:"hermes",status:"PENDING"}}),selected),false);
});
test("never skip an owed directed agent answer",()=>{
  assert.equal(safeToStartCollaborationAfterReplies(view({intervention:{open:{owed:[{to:"hermes",message_id:"q1"}]}}}),selected),false);
});
test("never bypass paused/failed/stopped run state",()=>{
  for(const status of ["PAUSED","STOPPED","FAILED"]) {
    assert.equal(safeToStartCollaborationAfterReplies(view({run_status:status}),selected),false);
  }
});
test("no duplicate live group-window even when no browser action is pending",()=>{
  for(const status of ["OPEN","RUNNING","ACTIVE","PAUSED_NO_PROGRESS","BLOCKED"]) {
    assert.equal(safeToStartCollaborationAfterReplies(view({collaboration:{status,open_pending:[]}}),selected),false);
  }
});
test("only an ended group window can be followed by another window in same run",()=>{
  assert.equal(safeToStartCollaborationAfterReplies(view({collaboration:{status:"ENDED"}}),selected),true);
});
test("ended group window with unresolved native-route failure is not safe to restart",()=>{
  const collab={status:"ENDED",open_pending:[{role:"hermes",turn_id:"S21",status:"PENDING",code:"ROUTE_FAILED"}]};
  assert.equal(safeToStartCollaborationAfterReplies(view({collaboration:collab}),selected),false);
});
test("older historical schema-1 room cannot be silently driven as schema-2",()=>{
  assert.equal(safeToStartCollaborationAfterReplies(view({schema:null}),selected),false);
});
test("unknown ACF state never triggers an agent dispatch",()=>{
  assert.equal(safeToStartCollaborationAfterReplies(null,selected),false);
});
