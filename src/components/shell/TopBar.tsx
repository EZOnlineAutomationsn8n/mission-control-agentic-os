"use client";

import { useEffect, useState } from "react";
import { connectorRegistry } from "@/lib/connectors/registry";
import type { AgentSystemState } from "@/lib/connectors/types";
import { countBlockedActions, countReadyActions, isLiveRunning } from "@/lib/ui-helpers";
import { usePanelFocus } from "@/components/shell/PanelFocus";

export function TopBar() {
  const { focusedPanelId, focusedPanelLabel, restoreLayout } = usePanelFocus();
  const [states, setStates] = useState<AgentSystemState[]>([]);
  const [clock, setClock] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const all = await Promise.all(connectorRegistry.list().map((a) => a.getState()));
      if (!cancelled) setStates(all);
    }
    void load();
    const t = setInterval(() => void load(), 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const tick = () => setClock(new Date().toUTCString().slice(17, 25) + " UTC");
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const running = states.filter(isLiveRunning).length;
  const approvals = states.reduce((sum, s) => sum + s.pendingApprovals.length, 0);
  const failing = states.filter((s) => s.health === "fail").length;
  const brainStatus = states.find((s) => s.id === "obsidian");
  const readyActions = countReadyActions(states);
  const blockedActions = countBlockedActions(states);
  const globalHealth = failing > 0 ? "warn" : "ok";

  return (
    <header className={`mc-topbar ${focusedPanelId ? "mc-topbar-focus-mode" : ""} h-14 flex items-center pl-16 pr-3 xl:px-4 gap-1.5 sticky top-0 z-20 overflow-x-auto overflow-y-hidden`}>
      {focusedPanelId && (
        <div className="mc-focus-topbar-state">
          <span className="text-[10px] font-semibold tracking-[0.12em] text-cyan-200">FOCUSED PANE</span>
          <span className="truncate text-xs text-foreground/90">{focusedPanelLabel}</span>
          <button type="button" className="mc-button mc-button-secondary mc-button-sm" onClick={restoreLayout}>
            Restore
          </button>
          <span className="hidden sm:inline text-[10px] text-muted">Esc</span>
        </div>
      )}
      <div className={`mc-top-metric ${globalHealth === "ok" ? "mc-top-metric-ok" : "mc-top-metric-warn"}`}>
        <span className="status-dot" style={{ backgroundColor: globalHealth === "ok" ? "var(--ok)" : "var(--warn)" }} />
        <span className="text-[11px] text-muted">Fleet</span>
        <span className={`text-[11px] font-semibold ${globalHealth === "ok" ? "text-ok" : "text-warn"}`}>{globalHealth === "ok" ? "Nominal" : "Degraded"}</span>
      </div>

      <div className="mc-top-metric mc-top-metric-info text-[11px] text-muted">
        <span>Services</span><span className="font-semibold mono text-foreground">{running}/{states.length}</span>
      </div>

      <div className={`mc-top-metric ${approvals > 0 ? "mc-top-metric-warn" : "mc-top-metric-neutral"} text-[11px] text-muted`}>
        <span>Approvals</span><span className={`font-semibold mono ${approvals > 0 ? "text-warn" : "text-foreground"}`}>{approvals}</span>
      </div>

      <div className={`mc-top-metric ${brainStatus?.status === "connected" ? "mc-top-metric-ok" : "mc-top-metric-neutral"} text-[11px] text-muted`}>
        <span>Brain</span><span className={`font-semibold ${brainStatus?.status === "connected" ? "text-ok" : "text-muted"}`}>{brainStatus?.status === "connected" ? "Connected" : brainStatus?.status ?? "Loading"}</span>
      </div>

      <div className="mc-top-metric mc-top-metric-ok text-[11px] text-muted">
        <span>Ready</span><span className="font-semibold mono text-ok">{readyActions}</span>
      </div>

      <div className={`mc-top-metric ${blockedActions > 0 ? "mc-top-metric-danger" : "mc-top-metric-neutral"} text-[11px] text-muted`}>
        <span>Blocked</span><span className={`font-semibold mono ${blockedActions > 0 ? "text-danger" : "text-muted"}`}>{blockedActions}</span>
      </div>

      <div className="flex-1 min-w-3" />
      <div className="mc-top-metric mc-top-metric-neutral mc-top-clock text-[10px] mono text-muted shrink-0">{clock}</div>
    </header>
  );
}
