import type { AcfMessageReadModel, AcfTeamRoomRun } from './types';
/** Derive identity from the existing cockpit registry, never from a model/provider. */
export interface TeamRosterAgent {id:string;label:string;apiAgentId:string;monogram:string}
export function deriveTeamRoomRoster(targets:readonly {id:string;label:string;apiAgentId:string}[]):TeamRosterAgent[]{
 const seen=new Set<string>();
 return targets.filter(t=>Boolean(t.id) && !seen.has(t.id) && !!seen.add(t.id)).map(t=>({id:t.id,label:t.label,apiAgentId:t.apiAgentId,monogram:t.label.split(/\s+/).map(w=>w[0]||'').join('').slice(0,3).toUpperCase()}));
}
export function agentMatchesId(roster:TeamRosterAgent,actual:string|null):boolean{
 return Boolean(actual && (actual===roster.id || actual===roster.apiAgentId));
}
export function exactParticipantMessages(run:AcfTeamRoomRun,agent:TeamRosterAgent):AcfMessageReadModel[]{
 const bindings=run.participants.filter(p=>agentMatchesId(agent,p.agentId) && p.sessionRef);
 const seen=new Set<string>();
 return run.messages.filter(message=>{
   const origin=message.origin;
   if(!origin || !origin.agentId || !origin.sessionRef || !origin.participantId || !origin.turnId) return false;
   const matched=bindings.some(binding=>binding.agentId===origin.agentId && binding.sessionRef===origin.sessionRef && binding.participantId===origin.participantId && binding.role===message.from);
   if(!matched || seen.has(message.messageId))return false;
   seen.add(message.messageId);
   return true;
 }).sort((a,b)=>a.sequence-b.sequence);
}
export function deriveCanonicalTurnState(run:AcfTeamRoomRun|null){
 const turns=run?.teamView?.turns??[];
 const last=turns.filter(t=>t.outcome==='POSTED'&&t.message_id).at(-1)??null;
 const inFlight=run?.teamView?.in_flight??null;
 const loopNext=run?.teamView?.loop?.next;
 const next=isRecord(loopNext) && typeof loopNext.role==='string'?loopNext.role:null;
 return {status:inFlight?'IN_FLIGHT_UNCONFIRMED':last?'LAST_SPOKE':'IDLE',lastRole:last?.role??null,lastMessageId:last?.message_id??null,nextExpectedRole:next,claim:isRecord(inFlight)&&typeof inFlight.claim==='string'?inFlight.claim:null};
}
function isRecord(v:unknown):v is Record<string,unknown>{return !!v && typeof v==='object' && !Array.isArray(v)}
