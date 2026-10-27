"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useIsWerkplaats } from "@/components/shell/PreviewIdentity";
import { connectorRegistry } from "@/lib/connectors/registry";
import { COCKPIT_AGENT_TARGETS, type CockpitAgentId, type CockpitSessionSummary } from "@/lib/cockpit/agent-registry";
import { getCockpitRoutePresentation } from "@/lib/cockpit-route-presentation";
import { statusColor, dotGlowStyle } from "@/lib/ui-helpers";
import type { AgentSystemState } from "@/lib/connectors/types";
import { usePanelFocus } from "@/components/shell/PanelFocus";
import { startBoundedPoll, fetchJsonBounded } from "@/lib/cockpit/bounded-poll";

type NavIcon = "graph" | "apps" | "control" | "paperclip" | "team" | "mastermind" | "pipeline" | "kanban" | "memory" | "approvals" | "evidence" | "registry" | "projects";

interface NavItem {
  href: string;
  label: string;
  icon: NavIcon;
  connectorId?: string;
}

const WORKSPACE: NavItem[] = [
  { href: "/", label: "Mission Control", icon: "control" },
  { href: "/paperclip", label: "Paperclip", icon: "paperclip", connectorId: "paperclip" },
  { href: "/team-room", label: "Team Room", icon: "team" },
  { href: "/mastermind", label: "AI Agent Mastermind", icon: "mastermind" },
  { href: "/apps", label: "Apps", icon: "apps" },
  { href: "/graph", label: "Kennisgraaf", icon: "graph" },
];

const SELF: NavItem[] = [
  { href: "/pipeline", label: "Pipeline", icon: "pipeline" },
  { href: "/queue", label: "Kanban", icon: "kanban" },
  { href: "/brain", label: "Memory", icon: "memory", connectorId: "obsidian" },
];

const SYSTEM: NavItem[] = [
  { href: "/approvals", label: "Approvals Center", icon: "approvals" },
  { href: "/evidence", label: "Evidence / Logs", icon: "evidence" },
  { href: "/registry", label: "System Registry", icon: "registry" },
  { href: "/projects", label: "Project Layer", icon: "projects" },
];

function SidebarIcon({ name }: { name: NavIcon }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      {name === "graph" && <><circle {...common} cx="6" cy="7" r="2.2" /><circle {...common} cx="18" cy="6" r="2.2" /><circle {...common} cx="12" cy="17" r="2.6" /><path {...common} d="M8 8l2.6 7M16.4 7.6l-3 7.2M8.2 7h7.6" /></>}
      {name === "apps" && <><rect {...common} x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect {...common} x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect {...common} x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect {...common} x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>}
      {name === "control" && <><rect {...common} x="4" y="4" width="16" height="16" rx="3" /><path {...common} d="M8 9h8M8 13h5M8 17h8" /></>}
      {name === "paperclip" && <path {...common} d="m20 11-8.5 8.5a5 5 0 0 1-7-7L14 3a3.4 3.4 0 0 1 4.8 4.8l-9.2 9.2a1.8 1.8 0 1 1-2.6-2.6l8.3-8.3" />}
      {name === "team" && <><circle {...common} cx="9" cy="9" r="3" /><circle {...common} cx="17" cy="10" r="2.2" /><path {...common} d="M3.5 19a5.5 5.5 0 0 1 11 0M14 18a4 4 0 0 1 7 0" /></>}
      {name === "mastermind" && <><path {...common} d="M9 4h6l3 3v6l-3 3H9l-3-3V7l3-3Z" /><circle {...common} cx="12" cy="10" r="2" /><path {...common} d="M9.5 15.5 8 20M14.5 15.5 16 20" /></>}
      {name === "pipeline" && <><circle {...common} cx="6" cy="6" r="2" /><circle {...common} cx="18" cy="6" r="2" /><circle {...common} cx="12" cy="18" r="2" /><path {...common} d="M8 6h8M7.2 7.7 11 16M16.8 7.7 13 16" /></>}
      {name === "kanban" && <><rect {...common} x="4" y="5" width="16" height="14" rx="2" /><path {...common} d="M9 5v14M15 5v14M6 9h1M11 12h2M17 8h1" /></>}
      {name === "memory" && <><path {...common} d="M8 5a4 4 0 0 0-4 4c0 1.4.7 2.6 1.8 3.3A4 4 0 0 0 9 19h6a4 4 0 0 0 3.2-6.4A4 4 0 0 0 16 5" /><path {...common} d="M9 8h6M9 12h6M10 16h4" /></>}
      {name === "approvals" && <><circle {...common} cx="12" cy="12" r="8" /><path {...common} d="m8.5 12 2.3 2.3 4.8-5" /></>}
      {name === "evidence" && <><path {...common} d="M6 3h9l3 3v15H6z" /><path {...common} d="M15 3v4h4M9 11h6M9 15h6" /></>}
      {name === "registry" && <><ellipse {...common} cx="12" cy="6" rx="7" ry="3" /><path {...common} d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>}
      {name === "projects" && <><path {...common} d="M4 7h6l2 2h8v10H4z" /><path {...common} d="M4 7V5h7l2 2" /></>}
    </svg>
  );
}

function agentMonogram(id: CockpitAgentId): string {
  switch (id) {
    case "claude-code": return "CC";
    case "hermes": return "H";
    case "openclaw": return "OC";
    case "antigravity": return "AG";
    case "gemini": return "G";
    case "codex": return "CX";
  }
}

function sessionColor(sessions: CockpitSessionSummary[]): string {
  if (sessions.some((session) => session.active && session.status === "error")) return "var(--danger)";
  if (sessions.some((session) => session.active && (session.status === "running" || session.status === "starting"))) return "var(--info)";
  if (sessions.some((session) => session.status === "error")) return "var(--danger)";
  return "var(--muted)";
}

export function Sidebar() {
  const pathname = usePathname();
  const werkplaats = useIsWerkplaats();
  const { focusedPanelId } = usePanelFocus();
  const [railPinned, setRailPinned] = useState(false);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restore the operator's sidebar choice in this browser
      setRailPinned(window.localStorage.getItem("mc.sidebar.rail") === "1");
    } catch { /* storage unavailable */ }
  }, []);
  const toggleRail = () => setRailPinned((current) => {
    const next = !current;
    try { window.localStorage.setItem("mc.sidebar.rail", next ? "1" : "0"); } catch { /* storage unavailable */ }
    return next;
  });
  const focusRail = focusedPanelId !== null || railPinned;
  const [states, setStates] = useState<Record<string, AgentSystemState>>({});
  const [sessions, setSessions] = useState<CockpitSessionSummary[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => startBoundedPoll(async (signal) => {
    const adapters = connectorRegistry.list();
    const results = await Promise.allSettled(adapters.map((adapter) => adapter.getState()));
    if (signal.aborted) return false;
    setStates((previous) => {
      const entries = results.map((result, index) => {
        const id = adapters[index].descriptor().id;
        if (result.status === "fulfilled") return [id, result.value] as const;
        const last = previous[id];
        return last ? [id, { ...last, status: "degraded" as const, health: "warn" as const,
          sessionIndexStatus: "stale" as const }] as const : null;
      }).filter((entry): entry is readonly [string, AgentSystemState] => entry !== null);
      return Object.fromEntries(entries);
    });
    return results.every((result) => result.status === "fulfilled");
  }, { intervalMs: 10_000, timeoutMs: 8_000, maxBackoffMs: 30_000 }), []);

  useEffect(() => startBoundedPoll(async (signal) => {
    try {
      const body = await fetchJsonBounded<{ sessions?: CockpitSessionSummary[] }>(
        "/api/cockpit/sessions", { signal }
      );
      if (!signal.aborted) setSessions(body.sessions ?? []);
      return !signal.aborted;
    } catch {
      // Retain previous entries; do not replace a failed read with a fake empty registry.
      return false;
    }
  }, { intervalMs: 5_000, timeoutMs: 8_000, maxBackoffMs: 30_000 }), []);

  function renderItem(item: NavItem) {
    const active = pathname === item.href;
    const live = item.connectorId ? states[item.connectorId] : undefined;
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => setMobileOpen(false)}
        className={`mc-sidebar-link flex items-center gap-2 px-2.5 text-sm mb-0.5 transition-colors min-w-0 ${active ? "mc-sidebar-active" : "text-foreground/75 hover:text-foreground"}`}
      >
        <span className="mc-nav-icon"><SidebarIcon name={item.icon} /></span>
        <span className="mc-sidebar-link-label flex-1 truncate">{item.label}</span>
        {live && <span className="status-dot shrink-0" style={dotGlowStyle(statusColor(live.status))} title={live.status} />}
        {live && live.pendingApprovals.length > 0 && <span className="text-[10px] rounded-full bg-warn/15 border border-warn/25 text-warn px-1.5 py-0.5 mono shrink-0">{live.pendingApprovals.length}</span>}
      </Link>
    );
  }

  // One global Mission Control Werkplaats version, with current page context.
  // No page/component-specific version numbers or separate version registry.
  const pageLabel = pathname === "/team-room"
    ? "Team Room"
    : [...WORKSPACE, ...SELF, ...SYSTEM].find((item) => item.href === pathname)?.label
      ?? (pathname.startsWith("/agents/") ? "Agent" : pathname.startsWith("/systems/") ? "Systeem" : "Mission Control");

  function section(title: string, items: NavItem[]) {
    const label = title === "Workspace" && werkplaats
      ? <div data-testid="mc-werkplaats-version" aria-label={`WERKPLAATS MISSION_CONTROL-V001 PAGINA: ${pageLabel}`}
             className="mx-2 mb-1 rounded-lg border border-amber-400/50 bg-amber-400/5 px-3 py-2">
          <div className="text-[15px] font-extrabold tracking-wide leading-tight text-amber-300">WERKPLAATS</div>
          <div className="mt-1 text-[12px] font-bold mono text-foreground whitespace-nowrap">MISSION_CONTROL-V001</div>
          <div className="mt-1 text-[11px] font-semibold text-amber-100/90">PAGINA: {pageLabel}</div>
        </div>
      : <div className="mc-sidebar-section-label px-3 pb-1.5">{title}</div>;
    return <div className="px-2 pt-3">{label}{items.map(renderItem)}</div>;
  }

  function agentPool() {
    return (
      <div className="px-2 pt-3">
        <div className="mc-sidebar-section-label px-3 pb-1.5">Agent / Session Pool</div>
        {COCKPIT_AGENT_TARGETS.map((target) => {
          const routePresentation = getCockpitRoutePresentation(target);
          const targetSessions = sessions.filter((session) => session.targetId === target.id);
          const live = target.connectorId ? states[target.connectorId] : undefined;
          const stateStyle = targetSessions.length > 0
            ? { backgroundColor: sessionColor(targetSessions) }
            : live
              ? dotGlowStyle(statusColor(live.status))
              : { backgroundColor: "var(--muted)" };
          return (
            <div key={target.id} className="mb-1 rounded-lg hover:bg-panel-2/30">
              <Link
                href={`/?agent=${target.id}`}
                onClick={() => {
                  setMobileOpen(false);
                  window.dispatchEvent(new CustomEvent("mission-control:select-agent", { detail: target.id }));
                }}
                className="mc-agent-row flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium min-w-0 text-foreground/90 hover:bg-panel-2/55 hover:text-foreground"
              >
                <span className="mc-agent-mark-wrap">
                  <span className="mc-agent-mark" data-agent={target.id}>{agentMonogram(target.id)}</span>
                  <span className="status-dot mc-agent-state-dot" style={stateStyle} title={targetSessions.some((session) => session.active) ? "active session present" : "no active session"} />
                </span>
                <span className="mc-agent-row-text">
                  <span className="mc-agent-row-label truncate">{target.label}</span>
                  <span className="mc-agent-row-meta">
                    <span
                      className="mc-agent-route-badge rounded border border-border/80 bg-panel-2 px-1.5 py-px text-[9px] font-semibold tracking-wide text-muted truncate"
                      title={routePresentation.routeStatusDetail}
                    >
                      {routePresentation.routeType} · {routePresentation.routeStatus}
                    </span>
                    <span className="mc-agent-session-count text-[10px] text-muted mono shrink-0">{targetSessions.length} session{targetSessions.length === 1 ? "" : "s"}</span>
                  </span>
                </span>
              </Link>
              {targetSessions.slice(0, 4).map((session) => (
                <Link
                  key={session.sessionId}
                  href={`/?agent=${target.id}&session=${encodeURIComponent(session.sessionId)}`}
                  onClick={() => {
                    setMobileOpen(false);
                    window.dispatchEvent(new CustomEvent("mission-control:bind-session", { detail: { targetId: target.id, sessionId: session.sessionId } }));
                  }}
                  className="mc-session-row mr-2 mb-0.5 flex items-center gap-1.5 rounded-r-md px-2 py-1 text-[11px] text-muted hover:text-foreground min-w-0"
                  title={`${session.displayName} · ${session.status}`}
                >
                  <span className="status-dot shrink-0" style={{ backgroundColor: session.status === "error" ? "var(--danger)" : session.active && (session.status === "running" || session.status === "starting") ? "var(--info)" : "var(--muted)" }} />
                  <span className="truncate flex-1 mono">{session.sessionId}</span>
                  <span className="shrink-0 capitalize text-muted/80">{session.status}</span>
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMobileOpen((open) => !open)}
        className="mc-mobile-nav-toggle xl:hidden fixed left-3 z-50 mc-button mc-button-secondary p-0"
        aria-label={mobileOpen ? "Close Mission Control navigation" : "Open Mission Control navigation"}
        aria-expanded={mobileOpen}
        aria-controls="mission-control-sidebar"
      >
        <svg viewBox="0 0 24 24" className="mc-icon" aria-hidden="true">
          {mobileOpen
            ? <path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            : <path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />}
        </svg>
      </button>
      {mobileOpen && (
        <button
          type="button"
          className="xl:hidden fixed inset-0 z-30 bg-[#02040c]/75 backdrop-blur-[2px]"
          aria-label="Close Mission Control navigation"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        id="mission-control-sidebar"
        className={`mc-sidebar ${focusRail ? "mc-sidebar-focus-rail" : ""} fixed inset-y-0 left-0 z-40 w-72 shrink-0 flex flex-col h-dvh overflow-hidden transition-[transform,width] duration-200 xl:sticky xl:top-0 xl:z-auto xl:h-screen xl:w-64 xl:translate-x-0 ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="mc-sidebar-brand px-4">
          <div className="mc-sidebar-brand-row flex items-center gap-2.5 w-full">
            <span className="mc-brand-orb mono text-[10px] font-black">MC</span>
            <div className="mc-sidebar-brand-copy min-w-0 flex-1">
              <div className="text-sm leading-5 font-semibold tracking-wide text-foreground truncate">Mission Control</div>
              <div className="text-[10px] leading-3 tracking-[0.12em] text-muted">AGENTIC OS</div>
            </div>
            <button type="button" onClick={toggleRail} className="mc-sidebar-rail-toggle hidden xl:inline-flex"
              aria-pressed={railPinned} aria-label={railPinned ? "Sidebar uitklappen" : "Sidebar inklappen tot pictogrammen"}
              title={railPinned ? "Sidebar uitklappen" : "Sidebar inklappen tot pictogrammen"}>
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true"><path d={railPinned ? "m9 6 6 6-6 6" : "m15 6-6 6 6 6"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4">
          {section("Workspace", WORKSPACE)}
          {agentPool()}
          {section("Self", SELF)}
          {section("System", SYSTEM)}
        </div>
      </aside>
    </>
  );
}
