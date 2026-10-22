import test from "node:test";
import assert from "node:assert/strict";
import { resolveRosterSession, isSessionBindable, operatorReadiness } from "../src/lib/acf/roster-selection";
const candidate = (sessions: Array<{session_ref:string;verdict:string}>,suggested_session:string|null=null)=>
  ({agent_id:"claude-code",route:"ENABLED",suggested_session,sessions});
test("reuse canonical eligible suggestion",()=>{
 const a=candidate([{session_ref:"acf-test",verdict:"ELIGIBLE"}],"acf-test");
 assert.equal(resolveRosterSession(a,undefined),"acf-test");
 assert.equal(operatorReadiness(a,undefined),"SESSION_READY");
});
test("deterministic eligible fallback independent of roster order",()=>{
 const a=candidate([{session_ref:"acf-z",verdict:"ELIGIBLE"},{session_ref:"acf-a",verdict:"ELIGIBLE"}]);
 assert.equal(resolveRosterSession(a,undefined),"acf-a");
});
test("do not auto-pin a personal session",()=>{
 const a=candidate([{session_ref:"operator-default",verdict:"ELIGIBLE_PIN_REQUIRED"}]);
 assert.equal(resolveRosterSession(a,undefined),"");
 assert.equal(operatorReadiness(a,undefined),"ELIGIBLE_PIN_REQUIRED");
 assert.equal(isSessionBindable(a,"operator-default",undefined),false);
 assert.equal(isSessionBindable(a,"operator-default","operator-default"),true);
});
test("excluded historical run never silently chosen",()=>{
 const a=candidate([{session_ref:"acf-dlg-proof-claude",verdict:"EXCLUDED_IN_USE_BY_OPEN_RUN"}],"acf-dlg-proof-claude");
 assert.equal(resolveRosterSession(a,undefined),"");
 assert.equal(operatorReadiness(a,undefined),"BLOCKED");
});
test("old error session cannot become eligible through selection",()=>{
 const a=candidate([{session_ref:"acf-bad",verdict:"EXCLUDED_ERROR"}]);
 assert.equal(isSessionBindable(a,"acf-bad","acf-bad"),false);
});
test("disabled route is blocked even for idle eligible session",()=>{
 const a={...candidate([{session_ref:"acf-test",verdict:"ELIGIBLE"}]),route:"DISABLED"};
 assert.equal(isSessionBindable(a,"acf-test",undefined),false);
 assert.equal(operatorReadiness(a,undefined),"BLOCKED");
});
test("no hardcoded six-row requirement; single agent may be bindable",()=>{
 const a=candidate([{session_ref:"acf-team-hermes-001",verdict:"ELIGIBLE"}]);
 assert.equal(isSessionBindable(a,resolveRosterSession(a,undefined),undefined),true);
});
