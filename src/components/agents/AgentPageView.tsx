"use client";

import Link from "next/link";
import { getAgentPage } from "@/lib/agent-pages";
import { getCockpitAgentTarget } from "@/lib/cockpit/agent-registry";
import { AgentConversationPanel } from "@/components/control-room/AgentConversationPanel";

export function AgentPageView({ agentId }: { agentId: string }) {
  const def = getAgentPage(agentId);
  if (!def) return <div className="p-6 text-sm text-danger">Unknown agent page: {agentId}. See the Agent / Session Pool for available agents.</div>;
  const target = getCockpitAgentTarget(def.id);

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div><h1 className="text-lg font-semibold">{def.name}</h1><p className="text-xs text-muted mt-1">{def.detected}</p></div>
      {def.plannedTabs.length > 0 && <div className="flex flex-wrap items-center gap-1.5">{def.plannedTabs.map((tab) => <span key={tab} className="text-xs rounded bg-panel-2 text-muted px-2.5 py-1">{tab}</span>)}<span className="text-[10px] uppercase tracking-wide text-muted ml-1">planned sections</span></div>}
      {def.missing && <div className="rounded-lg border border-warn/40 bg-warn/10 p-4 space-y-1"><div className="text-xs uppercase tracking-wide font-semibold text-warn">Action required</div><div className="text-sm text-foreground/90">{def.missing}</div></div>}
      {target ? (
        <div className="max-w-2xl space-y-2">
          <AgentConversationPanel agentId={target.apiAgentId} endpoint={target.actionEndpoint} label={target.label} sessionId={target.defaultSessionId} />
          <div className="text-xs"><Link href={`/?agent=${target.id}&session=${target.defaultSessionId}`} className="text-accent hover:underline">Open this session in the four-pane cockpit →</Link></div>
        </div>
      ) : !def.missing ? <div className="text-sm text-muted">No real session route attached.</div> : null}
    </div>
  );
}
