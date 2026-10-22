import test from 'node:test';
import assert from 'node:assert/strict';
import {runAcfControl,buildTeamOpenSpec,startTeamStep,stepStatus,ACF_TEAM_ROOM_HOME,type AcfRunner} from '../src/lib/acf/control-adapter';
import {parseTeamViewV1} from '../src/lib/acf/read-adapter';
import type {AcfRunExport} from '../src/lib/acf/types';
const detail:AcfRunExport={export_version:1,run_id:'T-1',last_seq:7,state_hash:'hash',replay_matches_record:true,state:{run:{goal:"fixture",project:"MISSION_CONTROL_AGENTIC_OS",status:"ACTIVE"}}};
const valid={view_version:1,run_id:'T-1',run_status:'ACTIVE',objective:'fixture',project:'MISSION_CONTROL_AGENTIC_OS',team_run_completed:false,state_hash:'hash',last_seq:7,replay_matches_record:true,next_safe_action:'WAIT',reentry_point:{journal:'fixture.jsonl'},participants:[],turns:[],in_flight:null,loop:{status:'STOPPED_ACCEPTED',reviews:[]},acceptance:null,completion:{completed:false,why_not:'RUN_NOT_COMPLETE'}};
test('team-view v1 separates loop stop from run completion and retains re-entry',()=>{const v=parseTeamViewV1(JSON.stringify(valid),'T-1',detail);assert.equal(v.loop?.status,'STOPPED_ACCEPTED');assert.equal(v.team_run_completed,false);assert.equal(v.reentry_point?.journal,'fixture.jsonl')});
test('invalid v1 schema, source mismatch and malformed exports deny',()=>{for(const change of [{state_hash:'other'},{run_id:'T-2'},{last_seq:8},{view_version:2},{turns:'not array'},{in_flight:'speaker'},{objective:'forged'},{run_status:'COMPLETED'},{completion:{completed:true,why_not:null}} ])assert.throws(()=>parseTeamViewV1(JSON.stringify({...valid,...change}),'T-1',detail));assert.throws(()=>parseTeamViewV1('{bad','T-1',detail))});

test('canonical argument hash is key-order invariant and Unicode preserving', async()=>{
  const {canonicalAcfJson,acfArgsSha256}=await import('../src/lib/acf/control-adapter');
  assert.equal(canonicalAcfJson({z:'é',a:{d:1,b:'β'}}),'{"a":{"b":"β","d":1},"z":"é"}');
  assert.equal(acfArgsSha256({z:'é',a:1}),acfArgsSha256({a:1,z:'é'}));
  assert.throws(()=>canonicalAcfJson({bad:Number.NaN}));
});
test('team-open builds a gated builder/reviewer spec for OpenClaw and Claude Code on the Team Room home, no key',async()=>{
  const calls:string[][]=[];
  const runner:AcfRunner=async(args)=>{calls.push(args);return JSON.stringify({run_id:JSON.parse(args[4]).run_id,run_status:'ACTIVE'})};
  const r=await runAcfControl('team-open',{objective:'Maak een plan',success_criterion:'Het plan heeft drie stappen'},runner);
  assert.equal(r.ok,true);
  assert.deepEqual(calls[0].slice(0,3),['team-open','--state-dir',ACF_TEAM_ROOM_HOME]);
  const spec=JSON.parse(calls[0][4]);
  assert.equal(spec.created_by,'DENNIS');
  assert.deepEqual(Object.values(spec.bindings).map((b)=>(b as {agent_id:string}).agent_id),['openclaw','claude-code']);
  assert.ok(spec.roles[1].capability_tags.includes('acf.review:contract:2'));
  assert.equal(spec.seed.to,'builder');
  assert.ok(!('operator_assertion' in spec));
});
test('bad requests are refused before ACF is called',async()=>{
  let called=false;const runner:AcfRunner=async()=>{called=true;return '{}'};
  for(const [verb,args] of [['DELETE',{}],['team-open',{objective:''}],['team-open',{objective:'x'}],['team-step',{run_id:'../x'}],['team-reconcile',{}]] as const){
    const r=await runAcfControl(verb,args,runner);assert.equal(r.ok,false);if(!r.ok)assert.equal(r.code,'ARGUMENTS');
  }
  assert.equal(called,false);
});
test('an ACF refusal is passed through as it is',async()=>{
  const runner:AcfRunner=async()=>{const e=Object.assign(new Error('exit 2'),{stdout:JSON.stringify({error:'TEAM_RUN_UNKNOWN',detail:'RUN-X'})});throw e};
  const r=await runAcfControl('team-reconcile',{run_id:'RUN-X'},runner);
  assert.equal(r.ok,false);if(!r.ok){assert.equal(r.code,'TEAM_RUN_UNKNOWN');assert.equal(r.detail,'RUN-X')}
});
test('a step runs in the background, one at a time per run, and reports its result',async()=>{
  let release:()=>void=()=>{};const gate=new Promise<void>((resolve)=>{release=resolve});
  const runner:AcfRunner=async(args)=>{await gate;assert.equal(JSON.parse(args[4]).live,true);return JSON.stringify({kind:'TURN',role:'builder'})};
  const first=startTeamStep('RUN-BG-1',runner);assert.equal(first.ok,true);
  const second=startTeamStep('RUN-BG-1',runner);assert.equal(second.ok,false);if(!second.ok)assert.equal(second.code,'STEP_ALREADY_RUNNING');
  assert.equal(stepStatus('RUN-BG-1')?.running,true);
  release();await new Promise((r)=>setTimeout(r,20));
  const s=stepStatus('RUN-BG-1');assert.equal(s?.running,false);assert.equal(s?.last?.ok,true);
});
test('the read side defaults to the Team Room home',async()=>{
  const {readAcfTeamRoomSnapshot}=await import('../src/lib/acf/read-adapter');
  const seen:string[][]=[];
  const snap=await readAcfTeamRoomSnapshot({runner:async(args)=>{seen.push(args);return JSON.stringify({export_version:1,runs:[]})}});
  assert.equal(snap.availability,'empty');assert.match(String(snap.source.stateDir),/state\/team-room$/);
  void buildTeamOpenSpec;
});
