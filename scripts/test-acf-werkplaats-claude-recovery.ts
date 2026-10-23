import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyClaudeError,planClaudeSession,RECOVERY_SESSION,LEGACY_SESSION,
  type RosterAgent } from "../src/lib/acf/werkplaats-session-recovery";

function agent(sessions:RosterAgent["sessions"],patch:Partial<RosterAgent>={}):RosterAgent {
 return {agent_id:"claude-code",route:"ENABLED",can_join_now:false,
  suggested_session:null,sessions,...patch};
}
test("legacy bad Claude Code session preserved; recovery is a new ACF-only key",()=>{
 const a=agent([{session_ref:LEGACY_SESSION,status:"error",verdict:"EXCLUDED_ERROR",
   last_error:'[claude-code:unrecognized_model] {"model":"claude-3-freecc-no-thinking/open_router/poolside/laguna-xs-2.1:free"}'}]);
 const decision=planClaudeSession(a);
 assert.equal(decision.status,"PREPARE_FRESH");
 assert.equal(decision.sessionRef,RECOVERY_SESSION);
 assert.equal(a.sessions[0].session_ref,LEGACY_SESSION);
 assert.equal(decision.proof.code,"CLAUDE_CLI_UNRECOGNIZED_MODEL");
 assert.deepEqual(decision.proof.triedRoutes,[]);
 assert.ok(decision.proof.triedAliases.includes("open_router/poolside/laguna-xs-2.1:free"));
});
test("eligible native ACF session is reused with no bootstrap",()=>{
 const a=agent([{session_ref:LEGACY_SESSION,status:"idle",verdict:"ELIGIBLE"}],
   {can_join_now:true,suggested_session:LEGACY_SESSION});
 assert.deepEqual([planClaudeSession(a).status,planClaudeSession(a).sessionRef],["READY",LEGACY_SESSION]);
});
test("a failed recovery ID refuses all later bootstraps",()=>{
 const a=agent([
  {session_ref:LEGACY_SESSION,status:"error",verdict:"EXCLUDED_ERROR"},
  {session_ref:RECOVERY_SESSION,status:"error",verdict:"EXCLUDED_ERROR",last_error:"all configured model routes failed"}]);
 const d=planClaudeSession(a);
 assert.equal(d.status,"BLOCKED");
 assert.equal(d.proof.code,"FCC_ALL_ROUTES_FAILED");
});
test("starting/running session cannot trigger a concurrent bootstrap",()=>{
 for(const status of ["starting","running"])assert.equal(planClaudeSession(agent([
   {session_ref:LEGACY_SESSION,status,verdict:"EXCLUDED_BUSY"}])).status,"BLOCKED");
});
test("unbound/disconnected roster cannot create phantom session",()=>{
 assert.equal(planClaudeSession(null).status,"UNKNOWN");
 assert.equal(planClaudeSession(agent([],{route:"DISABLED"})).status,"UNKNOWN");
});
test("route classification is proof-only; do not invent unobserved attempts",()=>{
 const proof=classifyClaudeError("all configured model routes failed");
 assert.equal(proof.triedRoutes.length,0);
 assert.equal(proof.triedAliases.length,0);
});
test("only explicitly observed operator route numbers are reported",()=>{
 const proof=classifyClaudeError("route #1: failed; route 8: timeout; route 8: failed");
 assert.deepEqual(proof.triedRoutes,[1,8]);
});
test("unknown text is redacted to a bounded diagnostic with no secret leak",()=>{
 const proof=classifyClaudeError("Sensitive launcher --token=SECRET_PASSWORD value");
 assert.equal(proof.code,"SESSION_ERROR_UNCLASSIFIED");
 assert.ok(!JSON.stringify(proof).includes("SECRET_PASSWORD"));
});
test("timeout, 429, transport and native-history errors are disambiguated",()=>{
 for(const [error,code] of [
  ["429 quota","FCC_RATE_LIMIT"],["ETIMEDOUT","TURN_TIMEOUT_UNCERTAIN"],
  ["fetch failed","FCC_TRANSPORT_UNREACHABLE"],["native session not found","NATIVE_SESSION_MISSING"],
 ]){
  assert.equal(classifyClaudeError(error).code,code);
 }
});
