import test from 'node:test';
import assert from 'node:assert/strict';
import {COCKPIT_AGENT_TARGETS} from '../src/lib/cockpit/agent-registry';
import {deriveTeamRoomRoster,exactParticipantMessages,deriveCanonicalTurnState} from '../src/lib/acf/dynamic-roster';
import type {AcfTeamRoomRun,AcfMessageReadModel} from '../src/lib/acf/types';
const roster=deriveTeamRoomRoster(COCKPIT_AGENT_TARGETS);
const t='2026-10-11T03:00:00Z';
const message=(messageId:string,agentId:string,sessionRef:string,sequence:number):AcfMessageReadModel=>({messageId,kind:'NOTE',from:'builder',to:'reviewer',body:`body ${messageId}`,inReplyTo:null,answered:false,sequence,at:t,origin:{via:'PARTICIPANT_DIALOGUE',turnId:'turn-'+messageId,participantId:'p-builder',agentId,sessionRef,contextThroughSequence:sequence-1,basedOnSequence:sequence-1,conversationRef:'conv-'+messageId,responseSha256:'sha'}});
const run={runId:'fixture',participants:[{role:'builder',participantId:'p-builder',agentId:'openclaw',sessionRef:'session-one',identityVerificationState:'CLAIMED'}],messages:[message('M2','openclaw','session-one',2),message('WRONG_SESSION','openclaw','session-two',3),message('WRONG_AGENT','claude-code','session-one',4),message('M1','openclaw','session-one',1),{...message('INCOMPLETE','openclaw','session-one',5),origin:null}],teamView:{turns:[{outcome:'POSTED',role:'builder',message_id:'M2'},{outcome:'POSTED',role:'reviewer',message_id:'M3'}],in_flight:null,loop:{next:{role:'builder'}}}} as unknown as AcfTeamRoomRun;
test('all six sidebar identities are derived, including Gemini and Codex',()=>assert.deepEqual(new Set(roster.map(a=>a.id)),new Set(['hermes','claude-code','openclaw','antigravity','gemini','codex'])));
test('new custom registered agent appears without a TeamRoomView change',()=>assert.equal(deriveTeamRoomRoster([...COCKPIT_AGENT_TARGETS,{id:'custom-worker',apiAgentId:'custom-worker',label:'Custom Worker'}]).at(-1)?.id,'custom-worker'));
test('agent identity remains separate when several share provider/model',()=>{const models=[{id:'one',label:'One',apiAgentId:'one',model:'qwen',provider:'ollama'},{id:'two',label:'Two',apiAgentId:'two',model:'qwen',provider:'ollama'}];assert.deepEqual(deriveTeamRoomRoster(models).map(x=>x.id),['one','two'])});
test('exact binding requires agent AND session AND participant provenance; chronology retained',()=>assert.deepEqual(exactParticipantMessages(run,roster.find(a=>a.id==='openclaw')!).map(m=>m.messageId),['M1','M2']));
test('unbound Gemini/Codex cannot inherit a participant utterance',()=>{assert.equal(exactParticipantMessages(run,roster.find(a=>a.id==='gemini')!).length,0);assert.equal(exactParticipantMessages(run,roster.find(a=>a.id==='codex')!).length,0)});
test('canonical last spoke, next expected and in-flight remain distinct',()=>{const a=deriveCanonicalTurnState(run);assert.equal(a.status,'LAST_SPOKE');assert.equal(a.lastRole,'reviewer');assert.equal(a.nextExpectedRole,'builder');const b=deriveCanonicalTurnState({...run,teamView:{...run.teamView!,in_flight:{claim:'Journal opened; outcome unknown'}}} as AcfTeamRoomRun);assert.equal(b.status,'IN_FLIGHT_UNCONFIRMED');assert.match(b.claim??'',/unknown/)});
test('no participant activity must not imply speaking',()=>{const s=deriveCanonicalTurnState({...run,teamView:{...run.teamView!,turns:[],in_flight:null}} as AcfTeamRoomRun);assert.equal(s.status,'IDLE');assert.equal(s.lastRole,null)});

test('narrow mobile rules keep terminals in flow without fixed-four geometry',async()=>{
  const {readFile}=await import('node:fs/promises');
  const css=await readFile('src/app/globals.css','utf8');
  assert.match(css,/\.acf-dynamic-terminals\s*\{display:grid;grid-template-columns:repeat\(auto-fit/);
  assert.match(css,/@media\s*\(max-width:420px\)/);
  assert.match(css,/\.acf-shell-focus-card\{top:auto!important;left:auto!important/);
  assert.match(css,/\.acf-shell-grid\{grid-template-rows:none!important/);
});

test('unknown or custom ACF participant cannot be assigned another registered agent terminal',()=>{
  const unknown={...run,participants:[{role:'builder',participantId:'p-builder',agentId:'unknown-custom-agent',sessionRef:'session-one',identityVerificationState:'CLAIMED'}]};
  for(const agent of roster)assert.equal(exactParticipantMessages(unknown as AcfTeamRoomRun,agent).length,0);
});
