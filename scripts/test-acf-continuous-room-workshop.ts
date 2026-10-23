import assert from "node:assert/strict";
import { test } from "node:test";
import { FREE_ROOM_STEPS_PER_CLICK, availableWindowFromStore, isUncertainTurnOutcome, readFreeRoomState } from "../src/lib/acf/continuous-room-policy";
import type { AcfTeamViewV1 } from "../src/lib/acf/types";

const base = (patch: Record<string, unknown> = {}): AcfTeamViewV1 => ({
  view_version: 1, schema: 2, run_id: "RUN-WORKSHOP-TEST", run_status: "ACTIVE",
  state_hash: "test", last_seq: 25, replay_matches_record: true, team_run_completed: false,
  next_safe_action: "TEAM_STEP", reentry_point: null, participants: [], turns: [],
  in_flight: null, loop: null, acceptance: null, completion: {},
  collaboration: { window_id: "C10", order: ["hermes", "openclaw"], rounds: 4, posted: 12,
    total: 18, status: "ACTIVE" },
  ...patch,
}) as AcfTeamViewV1;
const intervention = (owed: number) => ({
  open: { intervention_id: "I7", opened_seq: 8, opened_at: null, by_claim: "DENNIS",
    reason: "operator pause", messages: [], replies: [], orchestrator_answers: [],
    owed: Array.from({ length: owed }, (_,i) => ({ message_id: "M"+i, to: "hermes" })) },
  count: 1, history: [],
});
test("step budget is a bounded per-click safety window, never a lifetime room cap", () => {
  assert.ok(FREE_ROOM_STEPS_PER_CLICK >= 1 && FREE_ROOM_STEPS_PER_CLICK <= 32);
  for (const n of [18, 32, 900, 10000]) {
    const x=readFreeRoomState(base({last_seq: n}), "collaboration");
    assert.equal(x.mayStep,true, "history length must not consume UI lifetime turn budget: "+n);
  }
});
test("open ACF in_flight cannot be dispatched again", () => {
  assert.deepEqual(readFreeRoomState(base({in_flight:{step:5,expected_next:{role:"hermes"}}}),"collaboration").mayStep,false);
});
test("ACF paused intervention permits owed directed answers but not autonomous collaboration", () => {
  const v=base({run_status:"PAUSED",intervention:intervention(2)});
  assert.equal(readFreeRoomState(v,"replies").mayStep,true);
  assert.equal(readFreeRoomState(v,"collaboration").mayStep,false);
  assert.equal(readFreeRoomState(v,"collaboration").mayResume,false);
});
test("operator may resume existing paused intervention only with zero owed replies", () => {
  const v=base({run_status:"PAUSED",intervention:intervention(0)});
  assert.equal(readFreeRoomState(v,"collaboration").mayResume,true);
  assert.equal(readFreeRoomState(base({run_status:"PAUSED"}),"collaboration").mayResume,false);
});
test("explicit ACF no-progress and rate-limit states stay paused until ACF says otherwise", () => {
  for (const run_status of ["PAUSED_NO_PROGRESS","PAUSED_RATE_LIMIT","PAUSED"]) {
    const x=readFreeRoomState(base({run_status}),"collaboration");
    assert.equal(x.mayStep,false);
    assert.equal(x.kind,"paused");
  }
});
test("blocked, missing, ended, unknown collaboration states are fail closed", () => {
  for(const collaboration of [null, {window_id:"C10",status:"BLOCKED"}, {window_id:"C10",status:"UNKNOWN_NEW_STATE"}]){
    assert.equal(readFreeRoomState(base({collaboration}),"collaboration").mayStep,false);
  }
  assert.equal(readFreeRoomState(base({collaboration:{window_id:"C10",status:"ENDED"}}),"collaboration").kind,"ended");
  assert.equal(readFreeRoomState(null,"collaboration").kind,"unknown");
});
test("429/timeout/no response are never safe to blindly replay",()=>{
  for(const c of [undefined,"TIMEOUT","NETWORK","TURN_PENDING_RECONCILIATION","HTTP_429","RATE_LIMIT","UNKNOWN_OUTCOME"]) {
    assert.equal(isUncertainTurnOutcome(c),true);
  }
  assert.equal(isUncertainTurnOutcome("ANSWER_ALREADY_POSTED"),false);
});
test("no claimed consensus from text or window counts",()=>{
  const v=base({next_safe_action:"CONSENSUS_REQUIRES_EVIDENCE",collaboration:{window_id:"C10",status:"ACTIVE",posted:12,total:18}});
  const r=readFreeRoomState(v,"collaboration");
  assert.equal(r.kind,"ready");
  assert.ok(!r.label.includes("consensus"));
});

test("re-entry after reload derives continuation exclusively from durable ACF view",()=>{
  assert.equal(availableWindowFromStore(base({last_seq:90})),"collaboration");
  assert.equal(availableWindowFromStore(base({run_status:"PAUSED",intervention:intervention(2)})),"replies");
  assert.equal(availableWindowFromStore(base({in_flight:{step:7}})),null);
  assert.equal(availableWindowFromStore(base({run_status:"PAUSED",intervention:intervention(0)})),null);
  assert.equal(availableWindowFromStore(base({collaboration:{window_id:"C1",status:"ENDED"}})),null);
  assert.equal(availableWindowFromStore(null),null);
});

test("automatic PAUSED_NO_PROGRESS state from ACF can resume the exact durable run", () => {
  const paused = base({run_status: "PAUSED", collaboration: {
    window_id:"C16", order:["hermes","openclaw"], rounds:4,
    posted:6,total:8,status:"PAUSED_NO_PROGRESS",
    reason:"two complete repeated rounds",
  }});
  const value = readFreeRoomState(paused, "collaboration");
  assert.equal(value.kind, "paused");
  assert.equal(value.mayStep, false);
  assert.equal(value.mayResume, true);
  assert.match(value.label,/twee rondes zonder voortgang/);
  assert.equal(availableWindowFromStore(paused), null);
  const notDurableProof=base({run_status:"PAUSED", collaboration:{
    window_id:"C16", order:["hermes","openclaw"],rounds:4,
    posted:6,total:8,status:"ACTIVE",
  }});
  assert.equal(readFreeRoomState(notDurableProof,"collaboration").mayResume,false);
});
