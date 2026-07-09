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

/** Soft neon glow for status dots — subtle, not a toy-UI blinking effect. */
export function dotGlowStyle(hexColor: string): CSSProperties {
  return {
    backgroundColor: hexColor,
    boxShadow: `0 0 5px ${hexColor}99, 0 0 1px ${hexColor}`,
  };
}

export type PanelAccent = "cyan" | "magenta" | "purple";

export const PANEL_ACCENT_CYCLE: PanelAccent[] = ["cyan", "magenta", "purple"];

export function statusColor(status: ConnectorStatus): string {
  switch (status) {
    case "connected":
      return "#35e0c2";
    case "mock":
      return "#5aa6ff";
    case "degraded":
      return "#f2b84b";
    case "pending-setup":
      return "#6b7a8a";
    case "disconnected":
      return "#f2554b";
    default:
      return "#6b7a8a";
  }
}

export function runStateColor(state: RunState): string {
  switch (state) {
    case "running":
      return "#35e0c2";
    case "paused":
      return "#f2b84b";
    case "waiting-approval":
      return "#f2b84b";
    case "blocked":
      return "#f2554b";
    case "error":
      return "#f2554b";
    case "stopped":
      return "#6b7a8a";
    default:
      return "#6b7a8a";
  }
}

export function riskColor(risk: RiskLevel): string {
  switch (risk) {
    case "low":
      return "#35e0c2";
    case "medium":
      return "#f2b84b";
    case "high":
      return "#f2554b";
    case "critical":
      return "#ff2e63";
  }
}

export function workStateColor(state: WorkItemState): string {
  switch (state) {
    case "queued":
      return "#5aa6ff";
    case "running":
      return "#35e0c2";
    case "blocked":
      return "#f2554b";
    case "completed":
      return "#6b7a8a";
    case "failed":
      return "#ff2e63";
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
