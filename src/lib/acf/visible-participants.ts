/** Presentation only: draft selection never writes ACF run membership. */
export interface VisibleParticipant {
  key: string;
  id: string;
  agentId: string;
  role: string | null;
  sessionRef: string | null;
  kind: "DRAFT" | "CONFIRMED";
}
export function deriveVisibleParticipants(
  registry: readonly {id:string;apiAgentId:string}[],
  confirmed: readonly {role:string;agentId:string|null;sessionRef:string|null}[],
  draft: readonly string[],
): VisibleParticipant[] {
  if (draft.length) {
    const ids = new Set(draft);
    return registry.filter(agent=>ids.has(agent.id) || ids.has(agent.apiAgentId)).slice(0,8)
      .map(agent=>({key:"draft:"+agent.id,id:agent.id,agentId:agent.apiAgentId,
        role:null,sessionRef:null,kind:"DRAFT" as const}));
  }
  return confirmed.slice(0,8).map(p=>{
    const registered=registry.find(agent=>agent.apiAgentId===p.agentId||agent.id===p.agentId);
    return {key:"confirmed:"+p.role,id:registered?.id??p.agentId??"unknown",
      agentId:p.agentId??"unknown",role:p.role,sessionRef:p.sessionRef,kind:"CONFIRMED" as const};
  });
}
