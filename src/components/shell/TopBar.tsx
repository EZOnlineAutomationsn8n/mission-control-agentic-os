"use client";

import { useEffect, useState } from "react";
import { connectorRegistry } from "@/lib/connectors/registry";
import type { AgentSystemState } from "@/lib/connectors/types";
import { countBlockedActions, countReadyActions, isLiveRunning } from "@/lib/ui-helpers";

export function TopBar() {
  const [states, setStates] = useState<AgentSystemState[]>([]);
  const [clock, setClock] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const all = await Promise.all(connectorRegistry.list().map((a) => a.getState()));
      if (!cancelled) setStates(all);
    }
    load();
    const t = setInterval(load, 10000);
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
    <header className="h-12 border-b border-border bg-panel flex items-center px-4 gap-6 sticky top-0 z-10">
      <div className="flex items-center gap-2 text-xs">
        <span
          className="status-dot"
          style={{ backgroundColor: globalHealth === "ok" ? "var(--ok)" : "var(--warn)" }}
        />
        <span className="text-muted">Fleet health</span>
        <span className="font-medium">{globalHealth === "ok" ? "nominal" : "degraded"}</span>
      </div>

      <div className="text-xs text-muted">
        Connected services <span className="text-foreground font-medium mono">{running}</span>/{states.length}
      </div>

      <div className="text-xs text-muted">
        Pending approvals{" "}
        <span className={`font-medium mono ${approvals > 0 ? "text-warn" : "text-foreground"}`}>
          {approvals}
        </span>
      </div>

      <div className="text-xs text-muted">
        Brain registry{" "}
        <span className="text-accent font-medium">
          {brainStatus?.status === "connected" ? "connected" : brainStatus?.status ?? "loading"}
        </span>
      </div>

      <div className="text-xs text-muted">
        Ready actions <span className="font-medium mono text-ok">{readyActions}</span>
      </div>

      <div className="text-xs text-muted">
        Blocked actions <span className="font-medium mono text-warn">{blockedActions}</span>
      </div>

      <div className="flex-1" />

      <div className="text-xs mono text-muted">{clock}</div>
    </header>
  );
}
