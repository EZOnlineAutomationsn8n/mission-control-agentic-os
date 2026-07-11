"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { connectorRegistry } from "@/lib/connectors/registry";
import type { AgentSystemState } from "@/lib/connectors/types";
import {
  runStateColor,
  dotGlowStyle,
  PANEL_ACCENT_CYCLE,
  isLiveRunning,
  countReadyActions,
  countBlockedActions,
  countUsableSystems,
  countNotWired,
} from "@/lib/ui-helpers";
import { AgentWindow } from "@/components/control-room/AgentWindow";

// Mission Control home = the cockpit. ALL registered systems render as
// live panes directly on this page — watching an agent never requires
// opening its detail page. The FCC pane (the one commandable system) comes
// first and carries its real send form as primary pane content.

// Registry order already starts with claude-fcc; keep it explicit anyway.
function paneOrder(): string[] {
  const ids = connectorRegistry.ids();
  return ["claude-fcc", ...ids.filter((id) => id !== "claude-fcc")];
}

export default function MissionControlHome() {
  const [states, setStates] = useState<AgentSystemState[]>([]);

  async function refresh() {
    const all = await Promise.all(connectorRegistry.list().map((a) => a.getState()));
    setStates(all);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch-on-mount for a live adapter poll
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  const blocked = states.filter(
    (s) => s.runState === "blocked" || s.runState === "waiting-approval" || s.health === "fail"
  );
  const totalApprovals = states.reduce((sum, s) => sum + s.pendingApprovals.length, 0);
  const liveCount = states.filter((s) => s.outputKind === "live-status").length;
  const readyActions = countReadyActions(states);
  const blockedActions = countBlockedActions(states);
  const usableCount = countUsableSystems(states);
  const notWiredCount = countNotWired(states);

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">Mission Control</h1>
          <p className="text-xs text-muted mt-1">
            {states.length} systems · {usableCount} usable · {liveCount} live · {notWiredCount} not wired ·{" "}
            {states.filter(isLiveRunning).length} running · {readyActions} ready action
            {readyActions === 1 ? "" : "s"} · {blockedActions} blocked · {totalApprovals} demo approval
            {totalApprovals === 1 ? "" : "s"} pending
          </p>
        </div>
        <Link
          href="/systems/claude-fcc"
          className="text-xs rounded border border-accent/50 bg-accent/10 hover:bg-accent/20 transition-colors px-3 py-1.5 text-accent"
        >
          Free Claude Code full page →
        </Link>
      </div>

      {blocked.length > 0 && (
        <div className="rounded border border-danger/40 bg-danger/10 px-3 py-2">
          <span className="text-xs font-medium text-danger mr-2">Attention:</span>
          {blocked.map((s) => (
            <Link key={s.id} href={`/systems/${s.id}`} className="inline-flex items-center gap-1.5 text-xs mr-3 hover:text-accent">
              <span className="status-dot" style={dotGlowStyle(runStateColor(s.runState))} />
              {s.name} — {s.runState}
            </Link>
          ))}
        </div>
      )}

      {/* The cockpit: every registered system as a live pane, side-by-side.
          2 columns from 768px, 3 from 1280px, 4 from 1536px — multiple
          panes stay visible at real operator window widths. */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
        {paneOrder().map((id, i) => (
          <div key={id} className="min-w-0">
            <AgentWindow systemId={id} accent={PANEL_ACCENT_CYCLE[i % PANEL_ACCENT_CYCLE.length]} />
          </div>
        ))}
      </div>
    </div>
  );
}
