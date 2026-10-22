import test from "node:test";
import assert from "node:assert/strict";
import {
  runAcfControl, validateD8Participants, buildD8OpenSpec,
  type AcfRunner, type SessionLister,
} from "../src/lib/acf/control-adapter";

const participants = [
  { handle: "hermes", agent_id: "hermes", session_ref: "acf-team-hermes-001", roles: ["builder", "analyst"] },
  { handle: "openclaw", agent_id: "openclaw", session_ref: "acf-collab01-fresh-builder-openclaw-001", roles: [] },
  { handle: "claude", agent_id: "claude-code", session_ref: "acf-dlg-proof-claude", roles: ["reviewer"] },
];
const enabled = ["hermes", "openclaw", "claude-code"];
const lister: SessionLister = async () => participants.map(p => ({
  agentId:p.agent_id, sessionId:p.session_ref, status:"idle", active:true, executionMode:"on-demand-cli",
}));
const calls: Array<{verb:string;args:Record<string,unknown>;timeout:number}> = [];
let schema: number | null = 2;
const runner: AcfRunner = async (argv, timeout) => {
  const [verb,,,,raw] = argv; const args=JSON.parse(raw) as Record<string,unknown>;
  calls.push({verb,args,timeout});
  if(verb==="team-view") return JSON.stringify({schema,participants:participants.map(p => ({role:p.handle,agent_id:p.agent_id,session_ref:p.session_ref}))});
  return JSON.stringify({ok:true,run_id:String(args.run_id??"none"),turns_at_least:2,turns_at_most:4,verb});
};
test.beforeEach(()=>{calls.length=0;schema=2;});

test("D8 validation allows optional/shared function tags but requires independent sessions",()=>{
  assert.deepEqual(validateD8Participants(participants,enabled),participants);
  const overlap=[participants[0],{...participants[0],handle:"other"}];
  assert.equal(validateD8Participants(overlap,enabled),null);
  assert.equal(validateD8Participants([{...participants[0],handle:"BAD!"}],enabled),null);
  assert.equal(validateD8Participants([{...participants[0],agent_id:"untrusted"}],enabled),null);
});

test("opens THREE unique participants with optional and shared functions, no live model prompt",async()=>{
  const r=await runAcfControl("team-open-participants",{goal:"Two independent tasks",success_criterion:"Proof recorded",participants},runner,lister,enabled);
  assert.equal(r.ok,true);assert.equal(calls.length,1);assert.equal(calls[0].verb,"team-open-participants");
  assert.equal((calls[0].args.participants as unknown[]).length,3);
  assert.deepEqual((calls[0].args.participants as typeof participants)[0].roles,["builder","analyst"]);
  assert.equal(calls[0].args.created_by,"DENNIS");
  assert.equal(calls[0].args.max_turns,24);
});

test("D8 opening refuses unknown MC session without creating any run",async()=>{
  const wrong=participants.map(p=>({...p}));wrong[0].session_ref="does-not-exist";
  const r=await runAcfControl("team-open-participants",{goal:"x",participants:wrong},runner,lister,enabled);
  assert.equal(r.ok,false);assert.equal(calls.length,0);
});

test("two parallel conversation-only tasks can assign distinct builders and same independent reviewer",async()=>{
  for(const [id,assignee] of [["T1","openclaw"],["T2","hermes"]]){
    const r=await runAcfControl("team-task",{run_id:"RUN-D8-TEST",task_id:id,assignee,reviewer:"claude",brief:"Write a short checklist"},runner,lister,enabled);
    assert.equal(r.ok,true);
  }
  assert.equal(calls.filter(x=>x.verb==="team-task").length,2);
  assert.deepEqual(calls.filter(x=>x.verb==="team-task").map(x=>x.args.assignee),["openclaw","hermes"]);
  assert.ok(calls.every(x=>x.verb!=="team-step"));
});

test("task with no reviewer leaves reviewer undefined and ACF owns DONE_UNREVIEWED rule",async()=>{
  const r=await runAcfControl("team-task",{run_id:"RUN-D8-TEST",task_id:"T3",assignee:"hermes",brief:"Summarize"},runner,lister,enabled);
  assert.equal(r.ok,true);
  assert.equal("reviewer" in calls.at(-1)!.args,false);
});

test("same-agent reviewer is refused, even with separate handles",async()=>{
  const sameRunner:AcfRunner=async (argv,timeout) => {
    if(argv[0]==="team-view") return JSON.stringify({schema:2,participants:[
      ...participants.map(p=>({role:p.handle,agent_id:p.agent_id,session_ref:p.session_ref})),
      {role:"hermes2",agent_id:"hermes",session_ref:"parallel-proof-2"},
    ]});
    throw Error("should not dispatch task to ACF");
  };
  const r=await runAcfControl("team-task",{run_id:"RUN-D8-TEST",task_id:"T1",assignee:"hermes",reviewer:"hermes2",brief:"x"},sameRunner,lister,enabled);
  assert.equal(r.ok,false);
});

test("join additional independently registered session and refuse duplicate binding",async()=>{
  const newPerson={handle:"hermes2",agent_id:"hermes",session_ref:"parallel-proof-2",roles:["analysis"]};
  const list:SessionLister=async()=>[...(await lister()),{agentId:"hermes",sessionId:"parallel-proof-2",status:"idle",active:true}];
  const good=await runAcfControl("team-join",{run_id:"RUN-D8-TEST",...newPerson},runner,list,enabled);
  assert.equal(good.ok,true);assert.ok(calls.some(x=>x.verb==="team-join"));
  calls.length=0;
  const dup=await runAcfControl("team-join",{run_id:"RUN-D8-TEST",...participants[0]},runner,list,enabled);
  assert.equal(dup.ok,false);
  assert.equal(calls.some(x=>x.verb==="team-join"),false);
});

test("v1 team-open remains accepted and D8 mutations refuse v1 runs",async()=>{
  schema=null;
  const rejected=await runAcfControl("team-task",{run_id:"RUN-V1",task_id:"T1",assignee:"builder",brief:"x"},runner,lister,enabled);
  assert.equal(rejected.ok,false);assert.equal(rejected.code,"D8_SCHEMA_REQUIRED");
  const join=await runAcfControl("team-join",{run_id:"RUN-V1",handle:"hermes",agent_id:"hermes",session_ref:"acf-team-hermes-001"},runner,lister,enabled);
  assert.equal(join.ok,false);assert.equal(join.code,"D8_SCHEMA_REQUIRED");
  assert.equal(calls.some(x=>x.verb==="team-join"||x.verb==="team-task"),false);
});

test("schema-v2 opening has no fixed builder/reviewer core slots",()=>{
  const spec=buildD8OpenSpec("Go",participants,"One proof","RUN-D8-ONE");
  assert.equal(spec.run_id,"RUN-D8-ONE"); assert.equal("bindings" in spec,false);
  assert.equal("roles" in spec,false);
  assert.equal(spec.participants.length,3);
});
