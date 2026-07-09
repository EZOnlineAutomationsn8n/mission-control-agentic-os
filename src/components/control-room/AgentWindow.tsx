"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { connectorRegistry } from "@/lib/connectors/registry";
import type { AgentSystemState, OutputEvent } from "@/lib/connectors/types";
import { runStateColor, statusColor, dotGlowStyle, type PanelAccent } from "@/lib/ui-helpers";
import { ControlledActionPanel } from "./ControlledActionPanel";

// Large, readable "cockpit window" — the same component renders every
// system in every focus set (Core 4, Infrastructure 4). It only talks to
// the AgentSystemAdapter interface, exactly like ControlRoom.tsx (the full
// page); this is the condensed preview form of the identical contract, not
// a second, agent-specific UI.
//
// Operator-honesty contract for the footer:
//   - a system with a real controlledAction renders the REAL send form
//     (ControlledActionPanel) right here in the cockpit — input → Send →
//     visible output, no navigation required
//   - a system that cannot accept commands shows an ACTION REQUIRED panel
//     with the exact blocker reasons its adapter reports — never a
//     disabled fake Send button
//   - only a genuinely mock (not wired) system keeps the mock command
//     form, labeled as such

const MAX_STREAM_EVENTS = 30;

const ACCENT_CLASS: Record<PanelAccent, string> = {
  cyan: "cockpit-glow-cyan",
  magenta: "cockpit-glow-magenta",
  purple: "cockpit-glow-purple",
};

export function AgentWindow({ systemId, accent = "cyan" }: { systemId: string; accent?: PanelAccent }) {
  const adapter = connectorRegistry.get(systemId);
  const [state, setState] = useState<AgentSystemState | null>(null);
  const [stream, setStream] = useState<OutputEvent[]>([]);

  async function refresh() {
    if (!adapter) return;
    setState(await adapter.getState());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch-on-mount for a live mock adapter poll
    refresh();
    const t = setInterval(refresh, 8000);
    const unsub = adapter?.subscribeOutput((e) => {
      setStream((prev) => [...prev.slice(-(MAX_STREAM_EVENTS - 1)), e]);
    });
    return () => {
      clearInterval(t);
      unsub?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  if (!adapter) {
    return (
      <div className="rounded-xl border border-danger/40 bg-panel p-4 text-sm text-danger min-w-0">
        Unknown system: {systemId}
      </div>
    );
  }

  const d = adapter.descriptor();
  const liveStatus = state?.status ?? d.status;
  const isRunning = state?.runState === "running";
  const isLiveStatus = state?.outputKind === "live-status";
  const commandsEnabled = state?.commandExecution ?? true;

  // Single required pane label: READY TO USE / ACTION REQUIRED / OFFLINE /
  // BLOCKED / CONNECTED / NOT WIRED — derived from real adapter state.
  function paneLabel(): { text: string; cls: string } {
    if (!state || state.outputKind === "mock-stream") return { text: "NOT WIRED", cls: "text-warn bg-warn/10" };
    if (state.controlledAction) return { text: "READY TO USE", cls: "text-ok bg-ok/10" };
    if (state.status === "disconnected") return { text: "OFFLINE", cls: "text-danger bg-danger/10" };
    if (state.runState === "blocked" || state.runState === "waiting-approval")
      return { text: "BLOCKED", cls: "text-warn bg-warn/10" };
    if (state.capabilities.some((c) => c.kind === "blocked" || !c.available))
      return { text: "ACTION REQUIRED", cls: "text-warn bg-warn/10" };
    return { text: "CONNECTED", cls: "text-ok bg-ok/10" };
  }
  const label = paneLabel();

  return (
    <div
      className={`cockpit-panel rounded-xl flex flex-col min-w-0 h-[calc(100vh-13rem)] min-h-[26rem] max-h-[46rem] overflow-hidden transition-shadow ${
        isRunning ? ACCENT_CLASS[accent] : ""
      }`}
    >
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border bg-panel-2/60 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="status-dot shrink-0" style={dotGlowStyle(statusColor(liveStatus))} />
          <span className="font-semibold text-sm truncate">{d.name}</span>
          {state && (
            <span
              className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono shrink-0"
              style={{ color: runStateColor(state.runState), backgroundColor: `${runStateColor(state.runState)}22` }}
            >
              {state.runState}
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted mono shrink-0">mode: {d.activeMode}</div>
      </header>

      <div className="px-4 py-2.5 border-b border-border text-xs min-w-0">
        <span className="text-muted">Current task:</span>{" "}
        <span className="text-foreground break-words">{state?.currentTask ?? "— idle —"}</span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col px-4 py-3 gap-1.5 min-w-0">
        <div className="flex items-center justify-between text-[11px] shrink-0">
          <span className={`rounded px-1.5 py-0.5 font-medium tracking-wide ${label.cls}`}>{label.text}</span>
          <span className={state && state.pendingApprovals.length > 0 ? "text-warn" : "text-muted"}>
            {state?.pendingApprovals.length ?? 0} pending approval(s)
          </span>
        </div>

        {isLiveStatus && state?.statusDetail ? (
          <div className="flex-1 min-h-0 overflow-y-auto mono text-xs space-y-1 bg-panel-2 rounded p-2.5">
            {Object.entries(state.statusDetail).map(([key, value]) => (
              <div key={key} className="flex gap-2 min-w-0">
                <span className="text-muted shrink-0">{key}:</span>
                <span className="break-words min-w-0 text-foreground/90">{value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto mono text-xs space-y-1 bg-panel-2 rounded p-2.5">
            <AnimatePresence initial={false}>
              {stream.length === 0 && (
                <div className="text-muted">No output — this system has no real integration attached yet.</div>
              )}
              {stream.map((e) => (
                <motion.div key={e.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2 min-w-0">
                  <span className="text-muted shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
                  <span className={`break-words min-w-0 ${e.stream === "system" ? "text-accent" : "text-foreground/90"}`}>
                    {e.text}
                  </span>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>

      <div className="px-4 py-2 border-t border-border text-[11px] text-muted min-w-0 truncate">
        Memory target: <span className="mono">{state?.memoryWriteTarget ?? "—"}</span> · Session index:{" "}
        <span
          className={
            state?.sessionIndexStatus === "current"
              ? "text-ok"
              : state?.sessionIndexStatus === "stale"
              ? "text-warn"
              : "text-danger"
          }
        >
          {state?.sessionIndexStatus ?? "…"}
        </span>
      </div>

      <div className="px-4 py-3 border-t border-border shrink-0 space-y-2 max-h-[45%] overflow-y-auto">
        {state?.controlledAction ? (
          // Real, working operator action — the SAME form/endpoint as the
          // full system page, usable directly from the cockpit.
          <ControlledActionPanel systemId={systemId} action={state.controlledAction} />
        ) : state && !commandsEnabled ? (
          <ActionRequiredPanel state={state} />
        ) : (
          <div className="rounded border border-warn/40 bg-warn/10 p-2.5 space-y-1">
            <div className="text-[10px] uppercase tracking-wide font-semibold text-warn">Not wired</div>
            <div className="text-[11px] text-foreground/90">
              No real integration attached to {d.name} yet — no commands can be sent until its endpoint is wired.
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2">
          {state?.externalUrl && (
            <a
              href={state.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs rounded bg-accent/20 text-accent px-3 py-2 whitespace-nowrap shrink-0 hover:bg-accent/30"
            >
              Open real console
            </a>
          )}
          <Link
            href={`/systems/${systemId}`}
            className="text-xs rounded bg-panel-2 hover:bg-border transition-colors px-3 py-2 whitespace-nowrap shrink-0"
          >
            Inspect details
          </Link>
        </div>
      </div>
    </div>
  );
}

// Honest blocker panel: shown instead of a fake Send button when a system
// cannot accept operator commands. Reasons come straight from the
// adapter's declared capability entries — nothing invented in the UI.
function ActionRequiredPanel({ state }: { state: AgentSystemState }) {
  const blockers = state.capabilities
    .filter((c) => c.kind === "blocked" || !c.available)
    .map((c) => (c.kind === "blocked" ? c.reason ?? "blocked (no reason reported)" : `${c.kind}: ${c.reason ?? "unavailable"}`));
  const reads = state.capabilities.filter((c) => c.available && c.kind !== "status" && c.kind !== "blocked");

  return (
    <div className="rounded border border-warn/40 bg-warn/10 p-2.5 space-y-1">
      <div className="text-[10px] uppercase tracking-wide font-semibold text-warn">
        {blockers.length > 0 ? "Action required — not commandable" : "Connected but not commandable"}
      </div>
      {blockers.map((b, i) => (
        <div key={i} className="text-[11px] text-foreground/90">
          {b}
        </div>
      ))}
      {blockers.length === 0 && (
        <div className="text-[11px] text-foreground/90">No safe command endpoint is wired for this system yet.</div>
      )}
      {reads.length > 0 && (
        <div className="text-[11px] text-muted">
          Read available: {reads.map((r) => r.kind).join(", ")} — shown in the panel above.
        </div>
      )}
    </div>
  );
}
