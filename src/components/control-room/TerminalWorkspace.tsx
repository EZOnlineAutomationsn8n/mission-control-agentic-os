"use client";

import { useEffect, useMemo, useState } from "react";
import {
  COCKPIT_AGENT_TARGETS,
  getCockpitAgentTarget,
  type CockpitAgentId,
  type CockpitAgentTarget,
  type CockpitSessionSummary,
} from "@/lib/cockpit/agent-registry";
import { AgentConversationPanel } from "./AgentConversationPanel";
import { getCockpitRoutePresentation } from "@/lib/cockpit-route-presentation";
import { FocusablePanel } from "@/components/shell/PanelFocus";
import { startBoundedPoll, fetchJsonBounded } from "@/lib/cockpit/bounded-poll";

const STORAGE_KEY = "mission-control-pane-bindings-v5";
const LEGACY_STORAGE_KEY = "mission-control-terminal-slots-v2";
const ACTIVE_SLOT_KEY = "mission-control-active-terminal-v1";
const SESSION_KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

interface PaneBinding {
  targetId: CockpitAgentId;
  sessionId: string;
}

const DEFAULT_BINDINGS: PaneBinding[] = [
  { targetId: "hermes", sessionId: "mission-control-hermes" },
  { targetId: "claude-code", sessionId: "mission-control-claude-code" },
  { targetId: "openclaw", sessionId: "mission-control-openclaw" },
  { targetId: "antigravity", sessionId: "mission-control-antigravity" },
];

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_KEY_PATTERN.test(value);
}

function validBinding(value: unknown): value is PaneBinding {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { targetId?: unknown; sessionId?: unknown };
  return typeof candidate.targetId === "string" && Boolean(getCockpitAgentTarget(candidate.targetId)) && validSessionId(candidate.sessionId);
}

function bindingForLegacyTarget(value: string): PaneBinding | null {
  const target = getCockpitAgentTarget(value);
  return target ? { targetId: target.id, sessionId: target.defaultSessionId } : null;
}

function sessionStatusText(session: CockpitSessionSummary | undefined): string {
  if (!session) return "not started";
  return session.active ? session.status : `stopped · ${session.status}`;
}

function sessionDot(session: CockpitSessionSummary | undefined): string {
  if (session?.status === "error") return "var(--danger)";
  if (session?.status === "running" || session?.status === "starting") return "var(--info)";
  return "var(--muted)";
}

function TerminalSurface({ target, sessionId }: { target: CockpitAgentTarget; sessionId: string }) {
  return (
    <AgentConversationPanel
      key={`${target.id}:${sessionId}`}
      targetId={target.id}
      agentId={target.apiAgentId}
      endpoint={target.actionEndpoint}
      label={target.label}
      sessionId={sessionId}
      terminal
    />
  );
}

export function TerminalWorkspace() {
  const [bindings, setBindings] = useState<PaneBinding[]>(DEFAULT_BINDINGS);
  const [activeSlot, setActiveSlot] = useState(0);
  const [sessions, setSessions] = useState<CockpitSessionSummary[]>([]);
  const [sessionDiscoveryError, setSessionDiscoveryError] = useState<string | null>(null);
  const [presentationHydrated, setPresentationHydrated] = useState(false);

  useEffect(() => startBoundedPoll(async (signal) => {
    try {
      const body = await fetchJsonBounded<{ sessions?: CockpitSessionSummary[]; error?: string }>(
        "/api/cockpit/sessions", { signal }
      );
      if (!signal.aborted) {
        setSessions(body.sessions ?? []);
        setSessionDiscoveryError(null);
      }
      return !signal.aborted;
    } catch (error) {
      if (!signal.aborted) setSessionDiscoveryError(
        error instanceof Error ? error.message : "session discovery unavailable"
      );
      return false;
    }
  }, { intervalMs: 5_000, timeoutMs: 8_000, maxBackoffMs: 30_000 }), []);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      let nextActiveSlot = 0;
    const storedActiveSlot = Number(window.localStorage.getItem(ACTIVE_SLOT_KEY));
    if (Number.isInteger(storedActiveSlot) && storedActiveSlot >= 0 && storedActiveSlot < 4) {
      nextActiveSlot = storedActiveSlot;
      setActiveSlot(storedActiveSlot);
    }

    let nextBindings = [...DEFAULT_BINDINGS];
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length === 4 && parsed.every(validBinding)) nextBindings = parsed;
      } catch {
        // Invalid presentation state is ignored; runtime/session state is never touched.
      }
    } else {
      const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (legacy) {
        try {
          const parsed = JSON.parse(legacy);
          if (Array.isArray(parsed) && parsed.length === 4) {
            const migrated = parsed.map((value) => typeof value === "string" ? bindingForLegacyTarget(value) : null);
            if (migrated.every(Boolean)) nextBindings = migrated as PaneBinding[];
          }
        } catch {
          // Keep safe presentation defaults only.
        }
      }
    }

    const query = new URLSearchParams(window.location.search);
    const requested = query.get("agent");
    const requestedSession = query.get("session");
    const target = requested ? getCockpitAgentTarget(requested) : undefined;
    if (target) {
      const sessionId = validSessionId(requestedSession) ? requestedSession : target.defaultSessionId;
      nextBindings = nextBindings.map((binding, index) => index === nextActiveSlot ? { targetId: target.id, sessionId } : binding);
      window.history.replaceState({}, "", window.location.pathname);
    }
      setBindings(nextBindings);
      setPresentationHydrated(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function selectAgent(event: Event) {
      const requested = (event as CustomEvent<string>).detail;
      const target = getCockpitAgentTarget(requested);
      if (!target) return;
      const existing = sessions.find((session) => session.targetId === target.id && session.active)
        ?? sessions.find((session) => session.targetId === target.id);
      setBindings((current) => current.map((binding, index) => index === activeSlot
        ? { targetId: target.id, sessionId: existing?.sessionId ?? target.defaultSessionId }
        : binding));
    }
    function bindSession(event: Event) {
      const detail = (event as CustomEvent<{ targetId: string; sessionId: string }>).detail;
      const target = getCockpitAgentTarget(detail?.targetId);
      if (!target || !validSessionId(detail?.sessionId)) return;
      setBindings((current) => current.map((binding, index) => index === activeSlot
        ? { targetId: target.id, sessionId: detail.sessionId }
        : binding));
    }
    window.addEventListener("mission-control:select-agent", selectAgent);
    window.addEventListener("mission-control:bind-session", bindSession);
    return () => {
      window.removeEventListener("mission-control:select-agent", selectAgent);
      window.removeEventListener("mission-control:bind-session", bindSession);
    };
  }, [activeSlot, sessions]);

  useEffect(() => {
    if (!presentationHydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings));
  }, [bindings, presentationHydrated]);

  useEffect(() => {
    if (!presentationHydrated) return;
    window.localStorage.setItem(ACTIVE_SLOT_KEY, String(activeSlot));
  }, [activeSlot, presentationHydrated]);

  const sessionsByTarget = useMemo(() => {
    const map = new Map<CockpitAgentId, CockpitSessionSummary[]>();
    for (const target of COCKPIT_AGENT_TARGETS) map.set(target.id, []);
    for (const session of sessions) map.get(session.targetId)?.push(session);
    return map;
  }, [sessions]);

  function assignTarget(slotIndex: number, targetId: string) {
    const target = getCockpitAgentTarget(targetId);
    if (!target) return;
    const existing = sessionsByTarget.get(target.id)?.find((session) => session.active)
      ?? sessionsByTarget.get(target.id)?.[0];
    setBindings((current) => current.map((binding, index) => index === slotIndex
      ? { targetId: target.id, sessionId: existing?.sessionId ?? target.defaultSessionId }
      : binding));
    setActiveSlot(slotIndex);
  }

  function assignSession(slotIndex: number, sessionId: string) {
    if (!validSessionId(sessionId)) return;
    setBindings((current) => current.map((binding, index) => index === slotIndex ? { ...binding, sessionId } : binding));
    setActiveSlot(slotIndex);
  }

  function createSessionBinding(slotIndex: number) {
    const current = bindings[slotIndex];
    const target = getCockpitAgentTarget(current.targetId);
    if (!target) return;
    const sessionId = `${target.apiAgentId}-session-${Date.now().toString(36)}`.slice(0, 64);
    assignSession(slotIndex, sessionId);
  }

  return (
    <div className="space-y-2">
      {sessionDiscoveryError && (
        <div role="alert" className="rounded border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn">
          Session registry unavailable: {sessionDiscoveryError}. Existing pane bindings remain intact.
        </div>
      )}
      <div className="mc-mobile-pane-switcher" role="tablist" aria-label="Mission Control panes">
        {bindings.map((binding, slotIndex) => {
          const target = getCockpitAgentTarget(binding.targetId) ?? COCKPIT_AGENT_TARGETS[0];
          return (
            <button
              key={slotIndex}
              type="button"
              role="tab"
              aria-selected={activeSlot === slotIndex}
              onClick={() => setActiveSlot(slotIndex)}
              className={`mc-mobile-pane-tab ${activeSlot === slotIndex ? "mc-mobile-pane-tab-active" : ""}`}
            >
              P{slotIndex + 1}
              <span>{target.label}</span>
            </button>
          );
        })}
      </div>
      <div className="mc-terminal-grid grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
        {bindings.map((binding, slotIndex) => {
          const target = getCockpitAgentTarget(binding.targetId) ?? COCKPIT_AGENT_TARGETS[0];
          const routePresentation = getCockpitRoutePresentation(target);
          const targetSessions = sessionsByTarget.get(target.id) ?? [];
          const boundSession = targetSessions.find((session) => session.sessionId === binding.sessionId);
          const sessionOptions = boundSession || targetSessions.some((session) => session.sessionId === binding.sessionId)
            ? targetSessions
            : [{ targetId: target.id, agentId: target.apiAgentId, sessionId: binding.sessionId, displayName: binding.sessionId, active: false, status: "stopped" } as CockpitSessionSummary, ...targetSessions];
          return (
            <FocusablePanel
              key={slotIndex}
              id={`home-pane-${slotIndex + 1}`}
              label={`Pane ${slotIndex + 1} · ${target.label}`}
              className={`mc-terminal-pane-slot ${activeSlot === slotIndex ? "mc-terminal-pane-slot-active" : ""}`}
              inlineControls
            >
            <section
              data-agent={target.id}
              onMouseDown={() => setActiveSlot(slotIndex)}
              onFocusCapture={() => setActiveSlot(slotIndex)}
              className={'mc-pane overflow-hidden h-[calc(100dvh-9rem)] min-h-[36rem] max-h-[72rem] xl:h-[calc(100dvh-12rem)] xl:min-h-[48rem] flex flex-col ' + (activeSlot === slotIndex ? "mc-pane-selected" : "")}
            >
              <header className="mc-pane-header mc-operator-pane-header px-2.5 py-2 shrink-0">
                <div className="mc-operator-pane-header-controls flex flex-wrap items-center gap-2">
                  <span className="mc-pane-number">P{slotIndex + 1}</span>
                  <span className="status-dot shrink-0" style={{ backgroundColor: sessionDot(boundSession) }} title={sessionStatusText(boundSession)} />
                  <select
                    value={target.id}
                    onChange={(event) => assignTarget(slotIndex, event.target.value)}
                    className="mc-pane-agent-select mc-operator-agent-select min-w-[8.5rem] flex-[1_1_10rem] outline-none"
                    aria-label={`Agent for pane ${slotIndex + 1}`}
                  >
                    {COCKPIT_AGENT_TARGETS.map((entry) => {
                      const route = getCockpitRoutePresentation(entry);
                      return <option key={entry.id} value={entry.id} className="bg-panel text-foreground">{entry.label} · {route.routeType} · {route.routeStatus}</option>;
                    })}
                  </select>
                  <span className="mc-operator-route-badge rounded-full border border-border bg-panel-2 px-2 py-0.5 text-[9px] font-semibold tracking-wide text-foreground shrink-0" title={routePresentation.routeStatusDetail}>
                    {routePresentation.routeType} · {routePresentation.routeStatus}
                  </span>
                  <span className="mc-operator-session-status text-[10px] font-semibold text-muted shrink-0">{sessionStatusText(boundSession)}</span>
                  {activeSlot === slotIndex && <span className="mc-pane-selected-badge rounded-full px-2 py-0.5 text-[9px] font-semibold">Selected</span>}
                  <div className="mc-operator-session-control flex min-w-[13rem] flex-[1.4_1_17rem] items-center gap-1.5">
                    <span className="text-[9px] font-semibold tracking-wide text-muted shrink-0">Session</span>
                    <select
                      value={binding.sessionId}
                      onChange={(event) => assignSession(slotIndex, event.target.value)}
                      className="mc-pane-session-select mono min-w-0 flex-1 outline-none"
                      aria-label={`Session for pane ${slotIndex + 1}`}
                    >
                      {sessionOptions.map((session) => (
                        <option key={session.sessionId} value={session.sessionId} className="bg-panel text-foreground">
                          {session.sessionId} · {session.active ? session.status : "not active"}
                        </option>
                      ))}
                    </select>
                    <button type="button" onClick={() => createSessionBinding(slotIndex)} className="mc-button mc-button-secondary mc-button-sm mc-operator-new-session" title="Prepare a new independent session key for this pane; no runtime starts until Start is clicked">
                      New session
                    </button>
                  </div>
                </div>
              </header>
              <div className="flex-1 min-h-0"><TerminalSurface target={target} sessionId={binding.sessionId} /></div>
            </section>
            </FocusablePanel>
          );
        })}
      </div>
    </div>
  );
}
