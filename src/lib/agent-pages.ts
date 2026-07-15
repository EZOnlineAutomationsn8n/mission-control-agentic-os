// Agent page definitions for /agents/[id]. Pure data - one honest record
// per agent in the sidebar AGENTS section.

export interface AgentPageDef {
  id: string;
  name: string;
  connectorId: string | null;
  missing: string | null;
  plannedTabs: string[];
  detected: string;
}

export const AGENT_PAGES: AgentPageDef[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    connectorId: "claude-fcc",
    missing: null,
    plannedTabs: ["Chat", "Sessions", "Workspace", "Goal Mode"],
    detected: "Persistent Claude Code CLI session, FCC-backed route readiness, stored history and audit are verified on VPS staging.",
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    connectorId: "openclaw",
    missing: null,
    plannedTabs: ["Chat", "Sessions", "Control Room"],
    detected: "Persistent OpenClaw gateway-agent session, real replies, stored history and audit are verified on VPS staging.",
  },
  {
    id: "hermes",
    name: "Hermes",
    connectorId: "hermes",
    missing: null,
    plannedTabs: ["Chat", "Task", "Sessions", "Workspace", "MCPs", "Manage", "Control Room", "Goal Mode"],
    detected: "Persistent Hermes Agent CLI session, real replies, stored history and audit are verified on VPS staging.",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    connectorId: "agy",
    missing: null,
    plannedTabs: ["Chat", "Sessions", "Workspace", "Control Room"],
    detected: "Antigravity Agentic AI coding assistant CLI 1.1.1 is bound to the isolated Mission Control workspace with a persistent conversation, stored history and audit.",
  },
  {
    id: "gemini",
    name: "Gemini",
    connectorId: "gemini",
    missing: null,
    plannedTabs: ["Chat", "Sessions", "Workspace"],
    detected: "Gemini CLI 0.50.0 is installed with a persistent Mission Control session route. Its own VPS authentication is required before the first turn.",
  },
  {
    id: "codex",
    name: "Codex",
    connectorId: "codex",
    missing: null,
    plannedTabs: ["Chat", "Sessions", "Workspace", "Goal Mode"],
    detected: "Codex CLI 0.144.3 is authenticated through ChatGPT and has a persistent Mission Control session route with stored history and audit.",
  },
  {
    id: "kimi-code",
    name: "Kimi Code",
    connectorId: null,
    missing: "Kimi Code CLI/API is not detected on this host.",
    plannedTabs: ["Chat", "Sessions"],
    detected: "No Kimi executable or provider route is proven on this host.",
  },
  {
    id: "glm-5-2",
    name: "GLM 5.2",
    connectorId: null,
    missing: "No separate GLM provider route is configured.",
    plannedTabs: ["Chat"],
    detected: "No local GLM agent runtime is proven on this host.",
  },
];

export function getAgentPage(id: string): AgentPageDef | undefined {
  return AGENT_PAGES.find((agent) => agent.id === id);
}
