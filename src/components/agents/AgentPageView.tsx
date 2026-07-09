"use client";

import Link from "next/link";
import { getAgentPage } from "@/lib/agent-pages";
import { connectorRegistry } from "@/lib/connectors/registry";
import { AgentWindow } from "@/components/control-room/AgentWindow";

// One page per sidebar agent. Honest split:
//  - agent maps to a wired connector → render the real cockpit pane
//    (AgentWindow: live state + real send form where one exists);
//  - agent has no wired route → ACTION REQUIRED with the exact missing
//    integration, never a fake chat box.
// The tab strip is visual planning only and is labeled as planned.

export function AgentPageView({ agentId }: { agentId: string }) {
  const def = getAgentPage(agentId);

  if (!def) {
    return (
      <div className="p-6 text-sm text-danger">
        Unknown agent page: {agentId}. See the sidebar AGENTS section for available agents.
      </div>
    );
  }

  const connector = def.connectorId ? connectorRegistry.get(def.connectorId) : undefined;

  return (
    <div className="p-6 space-y-4 max-w-5xl">
      <div>
        <h1 className="text-lg font-semibold">{def.name}</h1>
        <p className="text-xs text-muted mt-1">{def.detected}</p>
      </div>

      {def.plannedTabs.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {def.plannedTabs.map((t) => (
            <span key={t} className="text-xs rounded bg-panel-2 text-muted px-2.5 py-1">
              {t}
            </span>
          ))}
          <span className="text-[10px] uppercase tracking-wide text-muted ml-1">planned sections</span>
        </div>
      )}

      {def.missing && (
        <div className="rounded-lg border border-warn/40 bg-warn/10 p-4 space-y-1">
          <div className="text-xs uppercase tracking-wide font-semibold text-warn">Action required</div>
          <div className="text-sm text-foreground/90">{def.missing}</div>
        </div>
      )}

      {connector ? (
        <div className="max-w-xl">
          <AgentWindow systemId={def.connectorId!} />
          <div className="mt-2 text-xs">
            <Link href={`/systems/${def.connectorId}`} className="text-accent hover:underline">
              Open full control room →
            </Link>
          </div>
        </div>
      ) : (
        !def.missing && <div className="text-sm text-muted">No connector attached.</div>
      )}
    </div>
  );
}
