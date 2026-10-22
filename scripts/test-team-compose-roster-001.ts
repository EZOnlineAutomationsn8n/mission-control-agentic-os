import test from "node:test";
import assert from "node:assert/strict";
import { readAcfTeamRoster, ACF_TEAM_CONTROL_VERBS, type AcfRunner, type SessionLister } from "../src/lib/acf/control-adapter";
const registry = [
  {apiAgentId:"claude-code",label:"Claude Code"},
  {apiAgentId:"hermes",label:"Hermes"},
  {apiAgentId:"openclaw",label:"OpenClaw"},
  {apiAgentId:"codex",label:"Codex"},
  {apiAgentId:"agy",label:"Antigravity"},
  {apiAgentId:"gemini",label:"Gemini"},
];
const rows = [
  {agentId:"hermes",sessionId:"acf-team-hermes-001",status:"error",active:true,lastError:"model restored from session"},
  {agentId:"openclaw",sessionId:"acf-collab01-fresh-builder-openclaw-001",status:"idle",active:true,lastError:null},
  {agentId:"claude-code",sessionId:"mission-control-claude-code",status:"idle",active:true,lastError:null},
];
const lister:SessionLister=async()=>rows;
let executed:Array<{verb:string;args:Record<string,unknown>;timeout:number}>=[];
const answer={roster_version:1,source:"CALLER_SNAPSHOT",agents:registry.map(a=>({
  agent_id:a.apiAgentId,label:a.label,route:"ENABLED",
  can_join_now:a.apiAgentId==="openclaw",suggested_session:a.apiAgentId==="openclaw"?rows[1].sessionId:null,
  pin_required_sessions:a.apiAgentId==="claude-code"?[rows[2].sessionId]:[],
  why_not:a.apiAgentId==="hermes"?"ACF sessions excluded: error":null,
  sessions:rows.filter(x=>x.agentId===a.apiAgentId),member:null,
})),run_id:null,run_schema:null,can_join_running_run:null,creates_sessions:false,sends_prompts:false};
const runner:AcfRunner=async (argv,timeout)=>{
  const args=JSON.parse(argv[4]) as Record<string,unknown>;
  executed.push({verb:argv[0],args,timeout});
  return JSON.stringify(answer);
};
test.beforeEach(()=>executed=[]);
test("team-roster runs exactly one ACF read with all six registry identities and real session snapshot",async()=>{
  const result=await readAcfTeamRoster(undefined,runner,lister,registry);
  assert.equal(result.ok,true);
  if(!result.ok)return;
  assert.deepEqual(result.answer,answer);
  assert.equal(executed.length,1);
  assert.equal(executed[0].verb,"team-roster");
  assert.deepEqual(executed[0].args.agents,registry.map(x=>({agent_id:x.apiAgentId,label:x.label})));
  assert.equal((executed[0].args.candidates as unknown[]).length,3);
  assert.equal((executed[0].args.candidates as Array<{lastError:string|null}>)[0].lastError,"model restored from session");
  assert.equal(executed[0].timeout,60_000);
});
test("roster adds run_id for member status without mutating state",async()=>{
  const result=await readAcfTeamRoster("RUN-ACF-ROSTER-01-LIVE-1",runner,lister,registry);
  assert.equal(result.ok,true);
  assert.equal(executed[0].args.run_id,"RUN-ACF-ROSTER-01-LIVE-1");
  assert.equal(executed[0].verb,"team-roster");
});
test("reject arbitrary runId before invoking ACF",async()=>{
  const result=await readAcfTeamRoster("../../etc/passwd",runner,lister,registry);
  assert.equal(result.ok,false);
  assert.equal(executed.length,0);
});
test("session index failure is a real blocker with no partial/fake roster",async()=>{
  const r=await readAcfTeamRoster(undefined,runner,async()=>{throw Error("database offline")},registry);
  assert.equal(r.ok,false);
  assert.equal(executed.length,0);
});
test("existing schema v2 control verbs retained for 3+ participants",()=>{
  for(const v of ["team-open-participants","team-task","team-join"])assert.ok(ACF_TEAM_CONTROL_VERBS.includes(v as never));
});
