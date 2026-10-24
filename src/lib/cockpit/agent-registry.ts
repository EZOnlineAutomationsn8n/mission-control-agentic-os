export type CockpitAgentId = "claude-code" | "hermes" | "openclaw" | "antigravity" | "gemini" | "codex";

export interface CockpitAgentTarget {
  id: CockpitAgentId;
  pageId: CockpitAgentId;
  apiAgentId: "claude-code" | "hermes" | "openclaw" | "agy" | "gemini" | "codex";
  connectorId: string | null;
  label: string;
  defaultSessionId: string;
  actionEndpoint: string;
  sessionEndpoint: string;
  runtimeFallback: string;
  processLabel: string;
  detected: string;
  plannedTabs: string[];
}

export interface CockpitSessionSummary {
  targetId: CockpitAgentId;
  agentId: CockpitAgentTarget["apiAgentId"];
  sessionId: string;
  runtimeSessionId: string | null;
  displayName: string;
  workspace: string;
  permissionMode: string;
  executionMode: string;
  status: "starting" | "prepared" | "idle" | "running" | "stopped" | "error";
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  profileId: string | null;
  projectId: string | null;
  role: string | null;
  assignmentPath: string | null;
  agentRuntime: string | null;
  transportModelAlias: string | null;
  actualRuntimeModel: string | null;
}

export const COCKPIT_AGENT_TARGETS: readonly CockpitAgentTarget[] = [
  {
    id: "claude-code", pageId: "claude-code", apiAgentId: "claude-code", connectorId: "claude-fcc",
    label: "Claude Code", defaultSessionId: "mission-control-claude-code",
    actionEndpoint: "/api/connectors/claude-code/actions/ask", sessionEndpoint: "/api/connectors/claude-code/session",
    runtimeFallback: "Claude Code CLI", processLabel: "on-demand CLI turn + persistent resumable session",
    detected: "Persistent Claude Code CLI session with stored Mission Control history and audit; FCC is transport/model-gateway evidence, not the agent identity.",
    plannedTabs: ["Chat", "Sessions", "Workspace", "Goal Mode"],
  },
  {
    id: "hermes", pageId: "hermes", apiAgentId: "hermes", connectorId: "hermes",
    label: "Hermes", defaultSessionId: "mission-control-hermes",
    actionEndpoint: "/api/connectors/hermes/actions/ask", sessionEndpoint: "/api/connectors/hermes/session",
    runtimeFallback: "Hermes Agent", processLabel: "Hermes CLI turn + persistent resumable session",
    detected: "Persistent Hermes CLI session route with per-session Mission Control history and audit.",
    plannedTabs: ["Chat", "Task", "Sessions", "Workspace", "MCPs", "Manage", "Control Room", "Goal Mode"],
  },
  {
    id: "openclaw", pageId: "openclaw", apiAgentId: "openclaw", connectorId: "openclaw",
    label: "OpenClaw", defaultSessionId: "mission-control-openclaw",
    actionEndpoint: "/api/connectors/openclaw/actions/ask", sessionEndpoint: "/api/connectors/openclaw/session",
    runtimeFallback: "OpenClaw CLI", processLabel: "OpenClaw gateway turn + persistent explicit session",
    detected: "Persistent explicit Mission Control OpenClaw profile/session route with stored history and audit; it does not attach the historical main session.",
    plannedTabs: ["Chat", "Sessions", "Control Room"],
  },
  {
    id: "antigravity", pageId: "antigravity", apiAgentId: "agy", connectorId: "agy",
    label: "Antigravity", defaultSessionId: "mission-control-antigravity",
    actionEndpoint: "/api/connectors/agy/actions/ask", sessionEndpoint: "/api/connectors/agy/session",
    runtimeFallback: "Antigravity CLI", processLabel: "Antigravity sandbox turn + persistent conversation",
    detected: "Antigravity coding-assistant CLI route with an independent persistent conversation per Mission Control session key.",
    plannedTabs: ["Chat", "Sessions", "Workspace", "Control Room"],
  },
  {
    id: "gemini", pageId: "gemini", apiAgentId: "gemini", connectorId: null,
    label: "Gemini", defaultSessionId: "operator-default",
    actionEndpoint: "/api/connectors/gemini/actions/ask", sessionEndpoint: "/api/connectors/gemini/session",
    runtimeFallback: "Gemini CLI 0.50.0", processLabel: "Gemini CLI headless turn + persistent resumable session",
    detected: "Gemini CLI has a persistent Mission Control session route; runtime authentication is reported by the real start/turn path rather than inferred from route presence.",
    plannedTabs: ["Chat", "Sessions", "Workspace"],
  },
  {
    id: "codex", pageId: "codex", apiAgentId: "codex", connectorId: null,
    label: "Codex", defaultSessionId: "operator-default",
    actionEndpoint: "/api/connectors/codex/actions/ask", sessionEndpoint: "/api/connectors/codex/session",
    runtimeFallback: "Codex CLI 0.144.3", processLabel: "Codex exec turn + persistent resumable thread",
    detected: "Codex CLI has a persistent Mission Control thread route with stored history and audit.",
    plannedTabs: ["Chat", "Sessions", "Workspace", "Goal Mode"],
  },
] as const;

export function getCockpitAgentTarget(id: string): CockpitAgentTarget | undefined {
  return COCKPIT_AGENT_TARGETS.find((target) => target.id === id || target.connectorId === id);
}

export function getCockpitAgentByApiId(apiAgentId: string): CockpitAgentTarget | undefined {
  return COCKPIT_AGENT_TARGETS.find((target) => target.apiAgentId === apiAgentId);
}

export function sessionUrl(target: CockpitAgentTarget, sessionId: string): string {
  return `${target.sessionEndpoint}?sessionId=${encodeURIComponent(sessionId)}`;
}
