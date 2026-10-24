import assert from "node:assert/strict";
import { test } from "node:test";
import { runAcfControl, type AcfRunner } from "../src/lib/acf/control-adapter";

function stub() {
  const calls: Array<{verb:string;args:Record<string,unknown>}> = [];
  const runner: AcfRunner = async argv => {
    const [verb,,,...rest] = argv;
    const args = JSON.parse(rest[1]) as Record<string,unknown>;
    calls.push({verb,args});
    if (verb==="team-view") return JSON.stringify({
      schema:2,run_status:"ACTIVE",in_flight:null,
      participants:[{role:"claude-code"},{role:"hermes"},{role:"openclaw"}]
    });
    return JSON.stringify({run_id:"RUN-010-OFFLINE",status:"SIMULATED",verb});
  };
  return {calls,runner};
}
const run_id="RUN-010-OFFLINE";
test("late reconcile uses Pass1A existing ACF verb, never sends model prompt",async()=>{
  const s=stub();
  const r=await runAcfControl("team-reconcile-late",{run_id},s.runner);
  assert.equal(r.ok,true);
  assert.deepEqual(s.calls.map(c=>c.verb),["team-view","team-reconcile-late"]);
  assert.deepEqual(s.calls[1].args,{run_id,by:"DENNIS"});
});
test("explicit operator consensus asks selected roles, no autonomous model turns",async()=>{
  const s=stub();
  const r=await runAcfControl("team-consensus-propose",
    {run_id,text:"Alleen doorgaan na browservalidatie",participants:["hermes","openclaw"]},s.runner);
  assert.equal(r.ok,true);
  assert.deepEqual(s.calls.map(c=>c.verb),["team-view","team-consensus-propose"]);
  assert.deepEqual(s.calls[1].args,{run_id,by:"DENNIS",
    text:"Alleen doorgaan na browservalidatie",participants:["hermes","openclaw"]});
});
test("unknown participant consensus is refused without posting",async()=>{
  const s=stub();
  const r=await runAcfControl("team-consensus-propose",{run_id,text:"test",participants:["unknown"]},s.runner);
  assert.equal(r.ok,false);
  assert.deepEqual(s.calls.map(c=>c.verb),["team-view"]);
});
test("no empty or malformed consensus mutation",async()=>{
  const s=stub();
  const r=await runAcfControl("team-consensus-propose",{run_id,text:""},s.runner);
  assert.equal(r.ok,false);
  assert.deepEqual(s.calls.map(c=>c.verb),["team-view"]);
});
test("stop reuses Pass1A team-stop rather than legacy cancel-run",async()=>{
  const s=stub();
  const r=await runAcfControl("team-stop",{run_id,reason:"Dennis stopt"},s.runner);
  assert.equal(r.ok,true);
  assert.deepEqual(s.calls.map(c=>c.verb),["team-view","team-stop"]);
  assert.deepEqual(s.calls[1].args,{run_id,by:"DENNIS",reason:"Dennis stopt"});
});
test("legacy v1 is forbidden on new Pass1A verbs",async()=>{
  const calls:string[]=[];
  const r=await runAcfControl("team-reconcile-late",{run_id},async args=>{
    calls.push(args[0]);return JSON.stringify({schema:1,participants:[],run_status:"ACTIVE",in_flight:null});
  });
  assert.equal(r.ok,false);
  assert.deepEqual(calls,["team-view"]);
});


test("responsive collaboration honors operator selection and never invents agents",async()=>{
  const s=stub();
  const result=await runAcfControl("team-collaborate",
    {run_id,rounds:3,routing_mode:"RESPONSIVE",participants:["claude-code","openclaw","hermes"]},s.runner);
  assert.equal(result.ok,true);
  assert.deepEqual(s.calls.map(c=>c.verb),["team-view","team-collaborate"]);
  assert.deepEqual(s.calls[1].args,{run_id,by:"DENNIS",rounds:3,
    routing_mode:"RESPONSIVE",participants:["claude-code","openclaw","hermes"]});
});
test("invalid adaptive mode never reaches collaboration mutation",async()=>{
  const s=stub();
  const result=await runAcfControl("team-collaborate",{run_id,routing_mode:"UNSAFE"},s.runner);
  assert.equal(result.ok,false);
  assert.deepEqual(s.calls.map(c=>c.verb),["team-view"]);
});
