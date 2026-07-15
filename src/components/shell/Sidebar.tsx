"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { connectorRegistry } from "@/lib/connectors/registry";
import { AGENT_PAGES } from "@/lib/agent-pages";
import { statusColor, dotGlowStyle } from "@/lib/ui-helpers";
import type { AgentSystemState } from "@/lib/connectors/types";

// Sidebar = the Agentic OS navigation spine: WORKSPACE (rooms), AGENTS
// (the team, one page each), SELF (personal pipeline/rooms), SYSTEM
// (governance surfaces). Connector-backed entries carry a live status dot;
// agents without a wired route are marked so honestly — the pages
// themselves state the exact missing integration.

interface NavItem {
  href: string;
  label: string;
  /** Registered connector id → live status dot. */
  connectorId?: string;
  /** True when the target agent/room has a working operator action today. */
  ready?: boolean;
}

const WORKSPACE: NavItem[] = [
  { href: "/", label: "Mission Control" },
  { href: "/paperclip", label: "Paperclip", connectorId: "paperclip" },
  { href: "/mastermind", label: "AI Agent Mastermind" },
];

const AGENTS: NavItem[] = AGENT_PAGES.filter((a) => a.connectorId).map((a) => ({
  href: a.connectorId ? `/?agent=${a.connectorId}` : `/agents/${a.id}`,
  label: a.name,
  connectorId: a.connectorId ?? undefined,
  ready: a.missing === null,
}));

const SELF: NavItem[] = [
  { href: "/pipeline", label: "Pipeline" },
  { href: "/queue", label: "Kanban" },
  { href: "/brain", label: "Memory", connectorId: "obsidian" },
];

const SYSTEM: NavItem[] = [
  { href: "/approvals", label: "Approvals Center" },
  { href: "/evidence", label: "Evidence / Logs" },
  { href: "/registry", label: "System Registry" },
  { href: "/projects", label: "Project Layer" },
];

const AGENT_SESSION_ENDPOINTS: Record<string, string> = {
  "claude-fcc": "/api/connectors/claude-code/session?sessionId=operator-default",
  hermes: "/api/connectors/hermes/session?sessionId=operator-default",
  agy: "/api/connectors/agy/session?sessionId=operator-default",
  openclaw: "/api/connectors/openclaw/session?sessionId=operator-default",
  gemini: "/api/connectors/gemini/session?sessionId=operator-default",
  codex: "/api/connectors/codex/session?sessionId=operator-default",
};

interface AgentSessionSummary {
  active: boolean;
  status: "starting" | "idle" | "running" | "stopped" | "error";
}

export function Sidebar() {
  const pathname = usePathname();
  const [states, setStates] = useState<Record<string, AgentSystemState>>({});
  const [agentSessions, setAgentSessions] = useState<Record<string, AgentSessionSummary | null>>({});

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const entries = await Promise.all(
        connectorRegistry.list().map(async (a) => [a.descriptor().id, await a.getState()] as const)
      );
      if (!cancelled) setStates(Object.fromEntries(entries));
    }
    load();
    const t = setInterval(load, 10000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadSessions() {
      const entries = await Promise.all(Object.entries(AGENT_SESSION_ENDPOINTS).map(async ([id, endpoint]) => {
        try {
          const response = await fetch(endpoint, { cache: "no-store" });
          if (!response.ok) return [id, null] as const;
          const body = await response.json() as { session?: AgentSessionSummary | null };
          return [id, body.session ?? null] as const;
        } catch {
          return [id, null] as const;
        }
      }));
      if (!cancelled) setAgentSessions(Object.fromEntries(entries));
    }
    void loadSessions();
    const timer = setInterval(() => void loadSessions(), 8_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  function renderItem(item: NavItem) {
    const active = item.href.startsWith("/?agent=") ? pathname === "/" : pathname === item.href;
    const live = item.connectorId ? states[item.connectorId] : undefined;
    const agentSession = item.connectorId ? agentSessions[item.connectorId] : undefined;
    const agentSessionColor = agentSession?.active
      ? agentSession.status === "error" ? "var(--danger)" : "var(--ok)"
      : "var(--accent)";
    return (
      <Link
        key={item.href}
        href={item.href}
        onClick={() => {
          if (item.connectorId && typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent("mission-control:select-agent", { detail: item.connectorId }));
          }
        }}
        className={`flex items-center gap-2 rounded px-3 py-1.5 text-sm mb-0.5 transition-colors min-w-0 ${
          active ? "bg-panel-2 text-accent" : "text-foreground/80 hover:bg-panel-2 hover:text-foreground"
        }`}
      >
        {item.ready ? (
          <span
            className="status-dot shrink-0"
            style={{ backgroundColor: agentSessionColor }}
            title={agentSession?.active ? `agent session ${agentSession.status}` : "agent terminal route configured; session stopped"}
          />
        ) : live ? (
          <span className="status-dot shrink-0" style={dotGlowStyle(statusColor(live.status))} title={live.status} />
        ) : (
          <span className="w-2 shrink-0" />
        )}
        <span className="flex-1 truncate">{item.label}</span>
        {item.ready && <span className="text-[9px] uppercase tracking-wide text-accent shrink-0">room</span>}
        {live && live.pendingApprovals.length > 0 && (
          <span className="text-[10px] rounded-full bg-warn/20 text-warn px-1.5 py-0.5 mono shrink-0">
            {live.pendingApprovals.length}
          </span>
        )}
      </Link>
    );
  }

  function section(title: string, items: NavItem[]) {
    return (
      <div className="px-2 pt-3">
        <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-muted">{title}</div>
        {items.map(renderItem)}
      </div>
    );
  }

  return (
    <aside className="w-64 shrink-0 border-r border-border bg-panel flex flex-col h-screen sticky top-0 overflow-hidden">
      <div className="px-4 py-4 border-b border-border">
        <div className="text-sm font-semibold tracking-wide text-foreground">MISSION CONTROL</div>
        <div className="text-[11px] text-muted mono">Agentic OS</div>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden pb-4">
        {section("Workspace", WORKSPACE)}
        {section("Agents", AGENTS)}
        {section("Self", SELF)}
        {section("System", SYSTEM)}
      </div>
    </aside>
  );
}
