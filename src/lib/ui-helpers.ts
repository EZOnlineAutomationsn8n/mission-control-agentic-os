import type { CSSProperties } from "react";
import type { AgentSystemState, ConnectorStatus, RiskLevel, RunState, WorkItemState } from "@/lib/connectors/types";

/** A system counts as "really running" only if it's backed by a live read, not a mock fallback. */
export function isLiveRunning(state: AgentSystemState): boolean {
  return state.outputKind === "live-status" && state.runState === "running";
}

/** Ready actions = capabilities beyond bare status that are actually available right now. */
export function countReadyActions(states: AgentSystemState[]): number {
  return states.reduce(
    (sum, s) => sum + s.capabilities.filter((c) => c.available && c.kind !== "status" && c.kind !== "blocked").length,
    0
  );
}

/** Blocked actions = explicit "blocked" capability entries, or any unavailable capability. */
export function countBlockedActions(states: AgentSystemState[]): number {
  return states.reduce(
    (sum, s) => sum + s.capabilities.filter((c) => c.kind === "blocked" || !c.available).length,
    0
  );
}

/** Usable systems = at least one real (non-status) capability is actually available. */
export function countUsableSystems(states: AgentSystemState[]): number {
  return states.filter((s) => s.capabilities.some((c) => c.available && c.kind !== "status" && c.kind !== "blocked"))
    .length;
}

/** Not-wired systems = still on the mock fallback, never confirmed live. */
export function countNotWired(states: AgentSystemState[]): number {
  return states.filter((s) => s.outputKind === "mock-stream").length;
}

/** Semantic status dot with a restrained luminance halo; identity colors are handled separately. */
export function dotGlowStyle(hexColor: string): CSSProperties {
  return {
    backgroundColor: hexColor,
    boxShadow: `0 0 0 1px rgba(255,255,255,0.08), 0 0 8px ${hexColor}44`,
  };
}

export type PanelAccent = "cyan" | "magenta" | "purple";

export const PANEL_ACCENT_CYCLE: PanelAccent[] = ["cyan", "magenta", "purple"];

export function statusColor(status: ConnectorStatus): string {
  switch (status) {
    case "connected":
      return "#22c55e";
    case "mock":
      return "#2563eb";
    case "degraded":
      return "#f59e0b";
    case "pending-setup":
      return "#a1a1a1";
    case "disconnected":
      return "#dc2626";
    default:
      return "#a1a1a1";
  }
}

export function runStateColor(state: RunState): string {
  switch (state) {
    case "running":
      return "#2563eb";
    case "paused":
      return "#f59e0b";
    case "waiting-approval":
      return "#f59e0b";
    case "blocked":
      return "#dc2626";
    case "error":
      return "#dc2626";
    case "stopped":
      return "#a1a1a1";
    default:
      return "#a1a1a1";
  }
}

export function riskColor(risk: RiskLevel): string {
  switch (risk) {
    case "low":
      return "#22c55e";
    case "medium":
      return "#f59e0b";
    case "high":
      return "#dc2626";
    case "critical":
      return "#dc2626";
  }
}

export function workStateColor(state: WorkItemState): string {
  switch (state) {
    case "queued":
      return "#2563eb";
    case "running":
      return "#2563eb";
    case "blocked":
      return "#dc2626";
    case "completed":
      return "#22c55e";
    case "failed":
      return "#dc2626";
  }
}

export function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}
