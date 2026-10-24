import test from "node:test";
import assert from "node:assert/strict";
import { buildD8OpenSpec, runAcfControl, type AcfRunner, type SessionLister } from "../src/lib/acf/control-adapter";

const agents = ["claude-code","hermes","openclaw"];
const members = [
  {handle:"claude-code", agent_id:"claude-code", session_ref:"acf-dlg-proof-claude", roles:[]},
  {handle:"hermes",agent_id:"hermes",session_ref:"acf-team-hermes-001",roles:[]},
  {handle:"openclaw",agent_id:"openclaw",session_ref:"acf-collab01-fresh-builder-openclaw-001",roles:[]},
];
const lister:SessionLister=async()=>members.map(m=>({agentId:m.agent_id,sessionId:m.session_ref,status:"idle",active:true}));
function harness(schema: number | null = 2) {
 const calls:Array<{verb:string;args:Record<string,unknown>}>= [];
 const runner:AcfRunner=async(argv)=>{
  const verb=argv[0], args=JSON.parse(argv[4]) as Record<string,unknown>;
  calls.push({verb,args});
  if(verb==="team-view")return JSON.stringify({schema,participants:members.map(m=>({role:m.handle,agent_id:m.agent_id,session_ref:m.session_ref}))});
  return JSON.stringify({run_id:"RUN-TEST",verb});
 };
 return {calls,runner};
}
test("Free Room opens with no goal and no criterion, no implied turn",async()=>{
 const h=harness();
 const result=await runAcfControl("team-open-participants",{participants:members},h.runner,lister,agents);
 assert.equal(result.ok,true);
 assert.deepEqual(h.calls.map(c=>c.verb),["team-open-participants"]);
 assert.equal("goal" in h.calls[0].args,false);
 assert.equal("max_turns" in h.calls[0].args,false);
 assert.equal("success_criteria" in h.calls[0].args,false);
 assert.equal("goal" in buildD8OpenSpec("",members,"","RUN-X"),false);
});
test("Operator talk: audience TEAM, one handle, two handles; no implicit collaboration",async()=>{
 const h=harness();
 for (const to of ["TEAM","hermes",["hermes","openclaw"]]) {
  const x=await runAcfControl("team-say",{run_id:"RUN-X",to,text:"Goedemorgen, gasten.",kind:"QUESTION"},h.runner,lister,agents);
  assert.equal(x.ok,true);
 }
 assert.deepEqual(h.calls.filter(c=>c.verb==="team-say").map(c=>c.args.to),["TEAM","hermes",["hermes","openclaw"]]);
 assert.ok(h.calls.filter(c=>c.verb==="team-say").every(c=>c.args.by==="DENNIS" && c.args.reply===true));
 assert.equal(h.calls.some(c=>c.verb==="team-step"||c.verb==="team-collaborate"),false);
});
test("Samenwerken is an explicit bounded ACF verb, with operator claim",async()=>{
 const h=harness();
 const c=await runAcfControl("team-collaborate",{run_id:"RUN-X",rounds:1,topic:"Stel je voor"},h.runner,lister,agents);
 assert.equal(c.ok,true);
 assert.deepEqual(h.calls.map(c=>c.verb),["team-view","team-collaborate"]);
 assert.equal(h.calls[1].args.by,"DENNIS");
 assert.equal(h.calls[1].args.rounds,1);
 assert.equal(h.calls[1].args.topic,"Stel je voor");
});
test("Samenwerken never reaches ACF mutation if rounds, members or schema are invalid",async()=>{
 const h=harness();
 for (const args of [
  {rounds:0},{rounds:5},{rounds:1.2},{rounds:1,participants:["hermes"]},
  {rounds:1,participants:["hermes","hermes"]},{rounds:1,participants:["hermes","outside"]},
  {rounds:1,topic:"bad\nnewline"},
 ]) {
  const result=await runAcfControl("team-collaborate",{run_id:"RUN-X",...args},h.runner,lister,agents);
  assert.equal(result.ok,false);
 }
 assert.equal(h.calls.some(c=>c.verb==="team-collaborate"),false);
 const v1=harness(null);
 const result=await runAcfControl("team-collaborate",{run_id:"RUN-X",rounds:1},v1.runner,lister,agents);
 assert.equal(result.ok,false);if(!result.ok)assert.equal(result.code,"D8_SCHEMA_REQUIRED");
 assert.equal(v1.calls.some(c=>c.verb==="team-collaborate"),false);
});

test("Free Room Stop maps only schema2 safe run to existing Pass1A ACF team-stop", async () => {
  const called: Array<{verb:string,args:Record<string,unknown>}> = [];
  const executor: AcfRunner = async argv => {
    const verb=argv[0], args=JSON.parse(argv[4]) as Record<string,unknown>;
    called.push({verb,args});
    return JSON.stringify(verb==="team-view" ? {schema:2,run_status:"PAUSED",in_flight:null} :
      {run_id:"RUN-X",run_status:"CANCELLED",last_seq:66});
  };
  const result=await runAcfControl("team-stop",{run_id:"RUN-X",reason:"Operator confirms stop"},executor,lister,agents);
  assert.equal(result.ok,true);
  assert.deepEqual(called.map(c=>c.verb),["team-view","team-stop"]);
  assert.deepEqual(called[1].args,{run_id:"RUN-X",by:"DENNIS",reason:"Operator confirms stop"});
});
test("Free Room Stop fail-closed for v1, in-flight, closed, invalid reason",async()=>{
  for(const scenario of [
    {schema:1,run_status:"ACTIVE",in_flight:null},
    {schema:2,run_status:"ACTIVE",in_flight:{step:5}},
    {schema:2,run_status:"CANCELLED",in_flight:null},
  ]){
    const seen:string[]=[];
    const executor:AcfRunner=async argv=>{
      seen.push(argv[0]);
      return JSON.stringify(scenario);
    };
    const result=await runAcfControl("team-stop",{run_id:"RUN-X"},executor,lister,agents);
    assert.equal(result.ok,false);
    assert.deepEqual(seen,["team-view"]);
  }
  const seen:string[]=[];
  const executor:AcfRunner=async argv=>{
    seen.push(argv[0]);
    return JSON.stringify({schema:2,run_status:"ACTIVE",in_flight:null});
  };
  const invalid=await runAcfControl("team-stop",{run_id:"RUN-X",reason:""},executor,lister,agents);
  assert.equal(invalid.ok,false);
  assert.deepEqual(seen,["team-view"]);
});
