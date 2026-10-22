import test from "node:test";
import assert from "node:assert/strict";
import { COCKPIT_AGENT_TARGETS } from "../src/lib/cockpit/agent-registry";
import { deriveVisibleParticipants } from "../src/lib/acf/visible-participants";
const targets=COCKPIT_AGENT_TARGETS.map(({id,apiAgentId})=>({id,apiAgentId}));
test("all six registry agents are discoverable; 1 through 6 draft cards exactly match operator selections",()=>{
  assert.equal(targets.length,6);
  for(let count=1;count<=6;count++){
    const selected=targets.slice(0,count).map(t=>t.apiAgentId);
    const cards=deriveVisibleParticipants(targets,[],selected);
    assert.equal(cards.length,count);
    assert.deepEqual(cards.map(c=>c.agentId),selected);
    assert.ok(cards.every(c=>c.kind==="DRAFT" && c.sessionRef===null && c.role===null));
  }
});
test("Gemini and Codex can appear in draft, deselection removes only draft card",()=>{
 const chosen=targets.map(x=>x.apiAgentId);
 assert.ok(deriveVisibleParticipants(targets,[],chosen).some(c=>c.id==="gemini"));
 assert.ok(deriveVisibleParticipants(targets,[],chosen).some(c=>c.id==="codex"));
 const cards=deriveVisibleParticipants(targets,[],chosen.filter(a=>a!=="gemini"));
 assert.equal(cards.length,5);
 assert.ok(!cards.some(c=>c.id==="gemini"));
});
test("a draft does not overwrite existing canonical v1 membership",()=>{
 const run=[{role:"builder",agentId:"openclaw",sessionRef:"acf-proof-1"},{role:"reviewer",agentId:"claude-code",sessionRef:"acf-proof-2"}];
 const draft=deriveVisibleParticipants(targets,run,["gemini","codex","hermes"]);
 assert.equal(draft.length,3);
 assert.ok(draft.every(x=>x.kind==="DRAFT"));
 const confirmed=deriveVisibleParticipants(targets,run,[]);
 assert.equal(confirmed.length,2);
 assert.deepEqual(confirmed.map(x=>x.sessionRef),["acf-proof-1","acf-proof-2"]);
 assert.ok(confirmed.every(x=>x.kind==="CONFIRMED"));
});
test("confirmed schema-v2 members match canonical agent/session/handle, never nonmembers",()=>{
 const members=[
 {role:"gemini_1",agentId:"gemini",sessionRef:"acf-gemini-1"},
 {role:"codex_1",agentId:"codex",sessionRef:"acf-codex-1"},
 {role:"hermes_1",agentId:"hermes",sessionRef:"acf-hermes-1"},
 {role:"claude_1",agentId:"claude-code",sessionRef:"acf-claude-1"},
 {role:"openclaw_1",agentId:"openclaw",sessionRef:"acf-openclaw-1"},
 {role:"agy_1",agentId:"agy",sessionRef:"acf-agy-1"},
 ];
 const cards=deriveVisibleParticipants(targets,members,[]);
 assert.equal(cards.length,6);
 assert.deepEqual(cards.map(x=>x.role),members.map(x=>x.role));
 assert.deepEqual(cards.map(x=>x.sessionRef),members.map(x=>x.sessionRef));
 assert.ok(cards.every(x=>x.kind==="CONFIRMED"));
 assert.equal(cards.find(x=>x.agentId==="agy")?.id,"antigravity");
});
test("same agent different sessions remain independent; unknown ACF identities not substituted with registry members",()=>{
 const cards=deriveVisibleParticipants(targets,[
 {role:"analyst_1",agentId:"gemini",sessionRef:"g1"},
 {role:"analyst_2",agentId:"gemini",sessionRef:"g2"},
 {role:"external",agentId:"missing-agent",sessionRef:"unknown-1"}],[]);
 assert.equal(new Set(cards.map(c=>c.key)).size,3);
 assert.deepEqual(cards.slice(0,2).map(c=>c.sessionRef),["g1","g2"]);
 assert.equal(cards[2].id,"missing-agent");
});
test("zero selected does not create fake member; max is 8 presentation cards",()=>{
 assert.deepEqual(deriveVisibleParticipants(targets,[],[]),[]);
 const many=Array.from({length:9},(_,i)=>({role:"role"+i,agentId:"gemini",sessionRef:"acf-"+i}));
 assert.equal(deriveVisibleParticipants(targets,many,[]).length,8);
});
