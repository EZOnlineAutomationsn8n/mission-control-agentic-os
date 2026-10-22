import test from 'node:test';
import assert from 'node:assert/strict';
import {readAcfTeamRoomSnapshot} from '../src/lib/acf/read-adapter';
import {deriveTeamRoomRoster,exactParticipantMessages} from '../src/lib/acf/dynamic-roster';
import {COCKPIT_AGENT_TARGETS} from '../src/lib/cockpit/agent-registry';
const options={projectRoot:'/workspace/projects/agentic-collaboration-fabric',stateDir:'/workspace/projects/agentic-collaboration-fabric/proofs/live/ACF_TEAM_ROOM_01_LIVE_1_READ_HOME',runId:'RUN-ACF-TEAM-ROOM-01-LIVE-1'};
test('certified owner snapshot is read by existing MC adapter with real M1 M2 M3 and exact bindings',async()=>{
  const s=await readAcfTeamRoomSnapshot(options);assert.equal(s.availability,'available',s.error??'');assert.equal(s.source.provenanceClass,'CERTIFIED_HISTORICAL_READ_SNAPSHOT');const run=s.selectedRun!;
  assert.deepEqual(run.messages.map(m=>[m.messageId,m.sequence]),[['M1',7],['M2',8],['M3',9]]);
  assert.equal(run.messages[0].from,'OPERATOR');assert.match(run.messages[0].body,/checklist/);
  assert.equal(run.messages[1].origin?.agentId,'openclaw');assert.equal(run.messages[1].origin?.sessionRef,'acf-dlg-proof-openclaw');
  assert.equal(run.messages[2].origin?.agentId,'claude-code');assert.equal(run.messages[2].origin?.sessionRef,'acf-dlg-proof-claude');assert.equal(run.messages[2].inReplyTo,'M2');assert.match(run.messages[2].body,/ACCEPT/);
  assert.equal(run.teamView?.run_status,'ACTIVE');assert.equal(run.teamView?.loop?.status,'STOPPED_ACCEPTED');assert.equal(run.teamView?.team_run_completed,false);assert.equal(run.teamView?.in_flight,null);
  const roster=deriveTeamRoomRoster(COCKPIT_AGENT_TARGETS);
  assert.deepEqual(exactParticipantMessages(run,roster.find(r=>r.id==='openclaw')!).map(m=>m.messageId),['M2']);
  assert.deepEqual(exactParticipantMessages(run,roster.find(r=>r.id==='claude-code')!).map(m=>m.messageId),['M3']);
});
