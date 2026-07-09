"use client";

import { useEffect, useMemo, useState } from "react";
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
import { CompactOverviewGrid } from "@/components/operator-home/CompactOverviewGrid";
import { FOCUS_SETS, DEFAULT_FOCUS_SET, type FocusSetId } from "@/lib/focus-sets";

export default function OperatorHome() {
  const [focus, setFocus] = useState<FocusSetId>(DEFAULT_FOCUS_SET);
  const [states, setStates] = useState<AgentSystemState[]>([]);

  async function refresh() {
    const all = await Promise.all(connectorRegistry.list().map((a) => a.getState()));
    setStates(all);
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch-on-mount for a live mock adapter poll
    refresh();
    const t = setInterval(refresh, 8000);
    return () => clearInterval(t);
  }, []);

  const activeSet = useMemo(() => FOCUS_SETS.find((f) => f.id === focus)!, [focus]);

  const otherActiveIds = useMemo(() => {
    if (!activeSet.systemIds) return [];
    const focused = new Set(activeSet.systemIds);
    return connectorRegistry.ids().filter((id) => !focused.has(id));
  }, [activeSet]);

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
    <div className="p-6 space-y-6">
      <Link
        href="/systems/claude-fcc"
        className="block rounded-lg border border-accent bg-accent/10 hover:bg-accent/20 transition-colors px-5 py-4"
      >
        <div className="text-xs uppercase tracking-wide text-accent mb-1">Primary action · USER-OPERABLE</div>
        <div className="text-base font-semibold text-foreground">Ask FCC / OwlAlpha →</div>
        <div className="text-xs text-muted mt-1">
          Send a single plain-text prompt and get a real answer back — verified working end-to-end via automatic
          model-route fallback (default route currently fails upstream; a working fallback route is used instead).
        </div>
      </Link>

      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold">Mission Control</h1>
          <p className="text-sm text-muted mt-1">
            Fleet of {states.length} connected systems (full catalog in System Registry) ·{" "}
            {usableCount} usable · {liveCount} live · {notWiredCount} not wired ·{" "}
            {states.filter(isLiveRunning).length} running (mock excluded) ·{" "}
            {readyActions} ready action{readyActions === 1 ? "" : "s"} · {blockedActions} blocked action
            {blockedActions === 1 ? "" : "s"} · {totalApprovals} awaiting approval
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-panel p-1">
          {FOCUS_SETS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFocus(f.id)}
              title={f.description}
              className={`text-xs rounded px-3 py-1.5 transition-colors ${
                focus === f.id ? "bg-accent/20 text-accent" : "text-muted hover:text-foreground hover:bg-panel-2"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {blocked.length > 0 && (
        <div className="rounded border border-danger/40 bg-danger/10 px-4 py-3">
          <div className="text-sm font-medium text-danger mb-1">Attention required</div>
          <ul className="text-sm space-y-1">
            {blocked.map((s) => (
              <li key={s.id} className="flex items-center gap-2">
                <span className="status-dot" style={dotGlowStyle(runStateColor(s.runState))} />
                <Link href={`/systems/${s.id}`} className="hover:text-accent">
                  {s.name}
                </Link>
                <span className="text-muted">
                  — {s.runState}
                  {s.pendingApprovals.length > 0 ? `, ${s.pendingApprovals.length} approval(s) pending` : ""}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {activeSet.systemIds ? (
        <>
          {/*
            Cockpit row — 4 windows side-by-side in one row, never wrapping
            into a 2x2 grid and never scrolling horizontally. `grid-cols-4`
            gives each column `minmax(0, 1fr)` (Tailwind's default track
            sizing), so the row always fits the available content width;
            each AgentWindow's root also carries `min-w-0` so its own
            content (long output lines, names) can never force overflow.
          */}
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            {activeSet.systemIds.map((id, i) => (
              <div key={id} className="min-w-0">
                <AgentWindow systemId={id} accent={PANEL_ACCENT_CYCLE[i % PANEL_ACCENT_CYCLE.length]} />
              </div>
            ))}
          </div>

          {otherActiveIds.length > 0 && (
            <div className="rounded-lg border border-border bg-panel p-3">
              <div className="text-xs text-muted mb-2">
                Other active systems — compact status only (switch focus set above for a full window)
              </div>
              <CompactStrip systemIds={otherActiveIds} />
            </div>
          )}
        </>
      ) : (
        <CompactOverviewGrid />
      )}
    </div>
  );
}

function CompactStrip({ systemIds }: { systemIds: string[] }) {
  const [states, setStates] = useState<AgentSystemState[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const all = await Promise.all(
        systemIds.map((id) => connectorRegistry.get(id)?.getState()).filter((p): p is Promise<AgentSystemState> => !!p)
      );
      if (!cancelled) setStates(all);
    }
    load();
    const t = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemIds.join(",")]);

  return (
    <div className="flex flex-wrap gap-2">
      {states.map((s) => (
        <Link
          key={s.id}
          href={`/systems/${s.id}`}
          className="flex items-center gap-2 text-xs rounded-full bg-panel-2 hover:bg-border transition-colors px-3 py-1.5"
        >
          <span className="status-dot" style={dotGlowStyle(runStateColor(s.runState))} />
          <span>{s.name}</span>
          {s.outputKind === "mock-stream" ? (
            <span className="text-muted mono">not wired</span>
          ) : (
            <span className="text-muted mono">{s.runState}</span>
          )}
          {s.pendingApprovals.length > 0 && <span className="text-warn mono">{s.pendingApprovals.length}</span>}
        </Link>
      ))}
    </div>
  );
}
