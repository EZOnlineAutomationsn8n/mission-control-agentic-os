import assert from "node:assert/strict";
import { test } from "node:test";
import { activityFromAcf } from "../src/components/team-room/acf-activity";
import type { AcfTeamRoomRun } from "../src/lib/acf/types";

const run=(overrides:Record<string,unknown>={})=>({
  participants:[{role:"hermes",agentId:"hermes"},{role:"openclaw",agentId:"openclaw"}],
  runState:"ACTIVE",
  messages:[{from:"hermes",kind:"ANSWER",sequence:10},{from:"openclaw",kind:"NOTE",sequence:11}],
  teamView:{in_flight:null,collaboration:{open_pending:[]}},
  ...overrides,
} as unknown as AcfTeamRoomRun);
test("real ACF journal message is not an active model turn",()=>{
  assert.equal(activityFromAcf(run(),"hermes",false).state,"ANSWERED");
  assert.equal(activityFromAcf(run(),"openclaw",false).state,"ANSWERED");
  assert.equal(activityFromAcf(run(),"openclaw",false).label,"Laatste bericht · #11");
});
test("isolated route-failed pending is not running, and doesn't affect the other agent",()=>{
  const data=run({teamView:{in_flight:null,collaboration:{open_pending:[{role:"hermes",status:"PENDING",code:"ROUTE_FAILED"}]}}});
  assert.equal(activityFromAcf(data,"hermes",false).state,"PENDING");
  assert.match(activityFromAcf(data,"hermes",false).label,/ROUTE_FAILED/);
  assert.equal(activityFromAcf(data,"openclaw",false).state,"ANSWERED");
});
test("in_flight only marks the exact ACF role running",()=>{
  const data=run({teamView:{in_flight:{role:"openclaw",status:"RUNNING"},collaboration:{open_pending:[]}}});
  assert.equal(activityFromAcf(data,"openclaw",false).state,"RUNNING");
  assert.notEqual(activityFromAcf(data,"hermes",false).state,"RUNNING");
});
test("unassigned or nonspecific in_flight never creates simultaneous activity",()=>{
  const data=run({teamView:{in_flight:{status:"RUNNING"},collaboration:{open_pending:[]}}});
  assert.notEqual(activityFromAcf(data,"openclaw",false).state,"RUNNING");
  assert.notEqual(activityFromAcf(data,"hermes",false).state,"RUNNING");
  assert.equal(activityFromAcf(data,"codex",false).state,"NOT_BOUND");
});
test("stale ACF data never claims live activity",()=>{
  const data=run({teamView:{in_flight:{role:"hermes"},collaboration:{open_pending:[]}}});
  assert.equal(activityFromAcf(data,"hermes",true).state,"UNKNOWN");
});
test("ACF intervention owed marks a waiting answer, not running",()=>{
  const data=run({teamView:{in_flight:null,collaboration:{open_pending:[]},intervention:{open:{owed:[{to:"openclaw",message_id:"q"}]}}}});
  assert.equal(activityFromAcf(data,"openclaw",false).state,"WAITING");
  assert.notEqual(activityFromAcf(data,"hermes",false).state,"WAITING");
});
test("absent ACF run and no bound role remain truthful",()=>{
  assert.equal(activityFromAcf(null,null,false).state,"NOT_BOUND");
  assert.equal(activityFromAcf(run(),"gemini",false).state,"NOT_BOUND");
});
