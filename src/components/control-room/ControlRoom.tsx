"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { connectorRegistry } from "@/lib/connectors/registry";
import type { AgentSystemState, OutputEvent } from "@/lib/connectors/types";
import { riskColor, runStateColor, statusColor, timeAgo, dotGlowStyle } from "@/lib/ui-helpers";
import { ControlledActionPanel } from "./ControlledActionPanel";
import { AgentConversationPanel } from "./AgentConversationPanel";
import { FocusablePanel } from "@/components/shell/PanelFocus";

// Generic control room — the SAME component renders every registered
// system. It knows nothing about Claude/Hermes/OpenClaw/etc. specifically;
// it only talks to the AgentSystemAdapter interface. This is the proof
// that UI never couples to a specific tool.

export function ControlRoom({ systemId }: { systemId: string }) {
  const adapter = connectorRegistry.get(systemId);
  const [state, setState] = useState<AgentSystemState | null>(null);
  const [stream, setStream] = useState<OutputEvent[]>([]);
  const [rejectReasonFor, setRejectReasonFor] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const streamEndRef = useRef<HTMLDivElement>(null);

  async function refresh() {
    if (!adapter) return;
    setState(await adapter.getState());
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional initial fetch-on-mount for a live mock adapter poll
    refresh();
    const t = setInterval(refresh, 6000);
    const unsub = adapter?.subscribeOutput((e) => {
      setStream((prev) => [...prev.slice(-199), e]);
    });
    return () => {
      clearInterval(t);
      unsub?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  useEffect(() => {
    streamEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [stream]);

  if (!adapter) {
    return <div className="p-6 text-sm text-danger">Unknown system: {systemId}</div>;
  }
  const d = adapter.descriptor();
  if (!state) return <div className="p-6 text-sm text-muted">Loading control room…</div>;

  async function run<T>(fn: () => Promise<T>) {
    await fn();
    await refresh();
  }

  const commandsEnabled = state.commandExecution;
  const isLiveStatus = state.outputKind === "live-status";

  return (
    <div className="p-6 flex flex-col gap-4 h-full">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="status-dot" style={dotGlowStyle(statusColor(state.status))} />
          <div>
            <h1 className="text-lg font-semibold">{d.name}</h1>
            <div className="text-xs text-muted">
              {d.type} · {state.modelOrService} · mode: {state.connectorMode}
            </div>
          </div>
          <span
            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono ml-3"
            style={{ color: runStateColor(state.runState), backgroundColor: `${runStateColor(state.runState)}22` }}
          >
            {state.runState}
          </span>
          {!commandsEnabled && !state.controlledAction && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono ml-1 text-warn bg-warn/10">
              needs integration
            </span>
          )}
          {state.controlledAction && state.status === "connected" && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono ml-1 text-ok bg-ok/10">
              live route available
            </span>
          )}
          {state.controlledAction && state.status !== "connected" && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono ml-1 text-warn bg-warn/10">
              connector unavailable
            </span>
          )}
        </div>

        <div className="flex gap-2 items-center">
          {state.externalUrl && (
            <a
              href={state.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs rounded bg-accent/20 text-accent px-3 py-1.5 hover:bg-accent/30"
            >
              Open {d.name}
            </a>
          )}
          {/* Run controls (start/pause/resume/stop) intentionally absent:
              no registered system has a real, safe run-control endpoint
              wired yet. They return only when a real integration exists —
              never as simulated buttons. */}
        </div>
      </header>

      <div className="flex flex-wrap gap-1.5">
        {state.capabilities.map((c, i) => (
          <span
            key={`${c.kind}-${i}`}
            title={c.reason}
            className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded mono ${
              c.kind === "blocked" || !c.available ? "text-warn bg-warn/10" : "text-ok bg-ok/10"
            }`}
          >
            {c.kind === "blocked" ? `blocked: ${c.reason ?? "no reason given"}` : `${c.kind}${c.available ? "" : " (blocked)"}`}
          </span>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 flex-1 min-h-0">
        {/* LEFT: command + task + approvals + reports */}
        <FocusablePanel id={`system-${systemId}-work`} label={`${d.name} · Work / Control`} className="lg:col-span-2 min-h-0">
        <div className="flex flex-col gap-4 min-h-0 h-full">
          <div className="rounded-lg border border-border bg-panel p-3">
            <div className="text-xs text-muted mb-1">Current task</div>
            <div className="text-sm">{state.currentTask ?? "— idle —"}</div>
          </div>

          {commandsEnabled && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 space-y-1">
              <div className="text-xs uppercase tracking-wide font-semibold text-warn">Not wired</div>
              <div className="text-xs text-foreground/90">
                No real integration is attached to {d.name} — its live reader could not be reached and only the
                local simulation transport remains. No commands can be sent until the real endpoint is wired.
              </div>
            </div>
          )}

          {state.controlledAction && (
            state.controlledAction.id === "claude-code-agent" ? (
              <AgentConversationPanel
                agentId="claude-code"
                endpoint={state.controlledAction.endpoint}
                label={state.controlledAction.label}
              />
            ) : (
              <ControlledActionPanel systemId={systemId} action={state.controlledAction} />
            )
          )}

          {!commandsEnabled && !state.controlledAction && (
            <div className="rounded-lg border border-warn/40 bg-warn/10 p-3 space-y-1">
              <div className="text-xs uppercase tracking-wide font-semibold text-warn">
                Action required — not commandable
              </div>
              {state.capabilities
                .filter((c) => c.kind === "blocked" || !c.available)
                .map((c, i) => (
                  <div key={i} className="text-xs text-foreground/90">
                    {c.kind === "blocked" ? c.reason ?? "blocked (no reason reported)" : `${c.kind}: ${c.reason ?? "unavailable"}`}
                  </div>
                ))}
              {state.capabilities.filter((c) => c.kind === "blocked" || !c.available).length === 0 && (
                <div className="text-xs text-foreground/90">
                  No safe command endpoint is wired for this system yet.
                </div>
              )}
            </div>
          )}

          <div className="rounded-lg border border-border bg-panel p-3 flex-1 min-h-0 overflow-y-auto">
            <div className="text-xs text-muted mb-2">
              Pending approvals ({state.pendingApprovals.length})
            </div>
            <div className="space-y-2">
              {state.pendingApprovals.length === 0 && (
                <div className="text-xs text-muted">No pending approvals for this system.</div>
              )}
              {state.pendingApprovals.map((a) => (
                <div key={a.id} className="rounded border border-border bg-panel-2 p-2 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">{a.requestedCapability}</span>
                    <span
                      className="text-[10px] uppercase px-1.5 py-0.5 rounded mono"
                      style={{ color: riskColor(a.riskLevel), backgroundColor: `${riskColor(a.riskLevel)}22` }}
                    >
                      {a.riskLevel}
                    </span>
                  </div>
                  <div className="text-muted">{a.context}</div>
                  <div className="flex gap-2 pt-1">
                    <button
                      className="rounded bg-ok/20 text-ok px-2 py-1 hover:bg-ok/30"
                      onClick={() => run(() => adapter.approve(a.id, "approved from control room"))}
                    >
                      Approve
                    </button>
                    {rejectReasonFor === a.id ? (
                      <form
                        className="flex gap-1 flex-1"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const reason = rejectReason.trim();
                          if (!reason) return;
                          await run(() => adapter.reject(a.id, reason));
                          setRejectReasonFor(null);
                          setRejectReason("");
                        }}
                      >
                        <input
                          autoFocus
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="reason…"
                          required
                          className="flex-1 bg-panel rounded px-2 py-1 outline-none focus:ring-1 focus:ring-danger"
                        />
                        <button
                          type="submit"
                          disabled={!rejectReason.trim()}
                          className="rounded bg-danger/20 text-danger px-2 py-1 hover:bg-danger/30 disabled:opacity-40"
                        >
                          Confirm
                        </button>
                      </form>
                    ) : (
                      <button
                        className="rounded bg-danger/20 text-danger px-2 py-1 hover:bg-danger/30"
                        onClick={() => setRejectReasonFor(a.id)}
                      >
                        Reject
                      </button>
                    )}
                  </div>
                  <div className="text-[10px] text-muted">
                    {a.auditTrail.map((ev, i) => (
                      <div key={i}>
                        {timeAgo(ev.at)} — {ev.actor} {ev.action}
                        {ev.reason ? `: ${ev.reason}` : ""}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <ReportsPanel systemId={systemId} reports={state.reports} onSaved={refresh} />
        </div>
        </FocusablePanel>

        {/* RIGHT: streaming output + logs */}
        <FocusablePanel id={`system-${systemId}-output`} label={`${d.name} · Output / Logs`} className="lg:col-span-3 min-h-0">
        <div className="flex flex-col gap-4 min-h-0 h-full">
          <div className="rounded-lg border border-border bg-panel-2 p-3 flex-1 min-h-0 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <span
                className={`text-[11px] rounded px-1.5 py-0.5 font-medium tracking-wide ${
                  isLiveStatus ? "text-ok bg-ok/10" : "text-warn bg-warn/10"
                }`}
              >
                {isLiveStatus ? "LIVE STATUS" : "mock stream"}
              </span>
            </div>
            {isLiveStatus && state.statusDetail ? (
              <div className="flex-1 overflow-y-auto mono text-xs space-y-1">
                {Object.entries(state.statusDetail).map(([key, value]) => (
                  <div key={key} className="flex gap-2">
                    <span className="text-muted shrink-0">{key}:</span>
                    <span className="text-foreground/90 break-words">{value}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto mono text-xs space-y-1">
                <AnimatePresence initial={false}>
                  {stream.length === 0 && <div className="text-muted">No output yet — send a command or start the system.</div>}
                  {stream.map((e) => (
                    <motion.div
                      key={e.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex gap-2"
                    >
                      <span className="text-muted shrink-0">{new Date(e.timestamp).toLocaleTimeString()}</span>
                      <span
                        className={
                          e.stream === "stderr"
                            ? "text-danger"
                            : e.stream === "system"
                            ? "text-accent"
                            : "text-foreground/90"
                        }
                      >
                        {e.text}
                      </span>
                    </motion.div>
                  ))}
                </AnimatePresence>
                <div ref={streamEndRef} />
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-panel p-3 h-56 flex flex-col">
            <div className="text-xs text-muted mb-2">Run history / structured logs</div>
            <div className="flex-1 overflow-y-auto mono text-xs space-y-1">
              {state.logs.map((l) => (
                <div key={l.id} className="flex gap-2">
                  <span className="text-muted shrink-0">{new Date(l.timestamp).toLocaleTimeString()}</span>
                  <span
                    className={
                      l.level === "error"
                        ? "text-danger"
                        : l.level === "warn"
                        ? "text-warn"
                        : "text-foreground/80"
                    }
                  >
                    [{l.level}] {l.message}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-panel p-3 text-xs">
            <div className="text-muted mb-1">Memory / writeback status</div>
            <div>
              Target: <span className="mono">{state.memoryWriteTarget ?? "—"}</span> · Session index:{" "}
              <span
                className={
                  state.sessionIndexStatus === "current"
                    ? "text-ok"
                    : state.sessionIndexStatus === "stale"
                    ? "text-warn"
                    : "text-danger"
                }
              >
                {state.sessionIndexStatus}
              </span>
            </div>
          </div>
        </div>
        </FocusablePanel>
      </div>
    </div>
  );
}

function ReportsPanel({
  systemId,
  reports,
  onSaved,
}: {
  systemId: string;
  reports: AgentSystemState["reports"];
  onSaved: () => void;
}) {
  const adapter = connectorRegistry.get(systemId)!;
  const [savingId, setSavingId] = useState<string | null>(null);

  async function save(reportId: string) {
    setSavingId(reportId);
    await adapter.saveReportToBrain(reportId);
    setSavingId(null);
    onSaved();
  }

  return (
    <div className="rounded-lg border border-border bg-panel p-3">
      <div className="text-xs text-muted mb-2">Files / reports</div>
      <div className="space-y-2 max-h-40 overflow-y-auto">
        {reports.length === 0 && <div className="text-xs text-muted">No reports yet.</div>}
        {reports.map((r) => (
          <div key={r.id} className="rounded border border-border bg-panel-2 p-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium">{r.title}</span>
              <span className="text-muted">{r.kind}</span>
            </div>
            <div className="text-muted mt-0.5 line-clamp-2">{r.excerpt}</div>
            <div className="flex items-center justify-between mt-1.5">
              <span className={r.savedToBrain ? "text-ok" : "text-muted"}>
                {r.savedToBrain ? `saved → ${r.brainPath}` : "not yet saved to Brain"}
              </span>
              {!r.savedToBrain && (
                <button
                  onClick={() => save(r.id)}
                  disabled={savingId === r.id}
                  className="rounded bg-accent/20 text-accent px-2 py-1 hover:bg-accent/30 disabled:opacity-50"
                >
                  {savingId === r.id ? "saving…" : "Save to Brain"}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
