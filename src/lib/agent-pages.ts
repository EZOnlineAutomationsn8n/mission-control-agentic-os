// Agent page definitions for /agents/[id]. Pure data — one honest record
// per agent in the sidebar AGENTS section. `connectorId` links to a real
// registered connector (live state + real send form where one exists);
// `missing` states the exact integration required before the agent can be
// operated from this cockpit. Nothing here fakes capability: an agent
// without a wired route gets an ACTION REQUIRED page, not a chat box.

export interface AgentPageDef {
  id: string;
  name: string;
  /** Registered connector id, when this agent maps to a live connector. */
  connectorId: string | null;
  /** Exact missing integration (null when the agent is operable). */
  missing: string | null;
  /** Planned page sections — rendered as a visual tab strip, marked planned. */
  plannedTabs: string[];
  /** What was actually verified on this host, for honest provenance. */
  detected: string;
}

export const AGENT_PAGES: AgentPageDef[] = [
  {
    id: "claude",
    name: "Claude",
    connectorId: null,
    missing:
      "No Claude bridge endpoint wired for this app — needs a local API route (e.g. /api/connectors/claude/ask) in front of a Claude session or the Claude API.",
    plannedTabs: ["Chat", "Sessions", "Workspace", "Goal Mode"],
    detected: "Claude Code CLI is used to build this repo, but no in-app bridge endpoint exists yet.",
  },
  {
    id: "openclaw",
    name: "OpenClaw",
    connectorId: "openclaw",
    missing:
      "No safe OpenClaw command endpoint wired — gateway is reachable (127.0.0.1:18789) but no isolated-session prompt route exists; old main session stays untouched.",
    plannedTabs: ["Chat", "Sessions", "Control Room"],
    detected: "openclaw gateway service detected and probed read-only; npm global package openclaw@2026.6.9 present.",
  },
  {
    id: "hermes",
    name: "Hermes",
    connectorId: "hermes",
    missing:
      "Hermes command route / gateway action endpoint not wired — integration contract is scaffold-only and no messaging platform is bridged.",
    plannedTabs: [
      "Chat",
      "Task",
      "Hermes Jarvis",
      "Studio",
      "Sessions",
      "Workspace",
      "MCPs",
      "Manage",
      "Control Room",
      "Goal Mode",
    ],
    detected: "hermes-gateway.service alive (degraded); contract status SCAFFOLD_ONLY read from live status endpoint.",
  },
  {
    id: "gemini",
    name: "Gemini",
    connectorId: null,
    missing: "Gemini CLI/API not detected on this host — needs install (or API key bridge) plus an app route.",
    plannedTabs: ["Chat", "Sessions", "Workspace"],
    detected: "No gemini binary on PATH and no ~/.gemini config found.",
  },
  {
    id: "antigravity",
    name: "Antigravity",
    connectorId: null,
    missing: "Antigravity is a desktop IDE — no local installation or bridge endpoint detected on this host.",
    plannedTabs: ["Chat", "Workspace"],
    detected: "No antigravity binary or config found on this host.",
  },
  {
    id: "codex",
    name: "Codex",
    connectorId: null,
    missing:
      "codex binary not found on PATH — state directory /root/.codex exists (sessions/goals/memories SQLite), so the CLI was installed before; reinstall the CLI or wire an API route.",
    plannedTabs: ["Chat", "Sessions", "Workspace", "Goal Mode"],
    detected: "/root/.codex state dir present (goals/logs/memories/state SQLite + skills); no codex executable on PATH.",
  },
  {
    id: "kimi-code",
    name: "Kimi Code",
    connectorId: null,
    missing: "Kimi Code CLI/API not detected on this host — needs install plus an app route.",
    plannedTabs: ["Chat", "Sessions"],
    detected: "No kimi binary or config found on this host.",
  },
  {
    id: "glm-5-2",
    name: "GLM 5.2",
    connectorId: null,
    missing: "No GLM provider configured — needs a provider route (e.g. via FCC/OpenRouter model route) before use.",
    plannedTabs: ["Chat"],
    detected: "No local GLM provider config proven on this host.",
  },
  {
    id: "free-claude-code",
    name: "Free Claude Code",
    connectorId: "claude-fcc",
    missing: null,
    plannedTabs: ["Chat", "Sessions"],
    detected:
      "Working route: POST /api/connectors/fcc/actions/ask → 127.0.0.1:8082/v1/messages (verified in browser: input → Send → answer).",
  },
];

export function getAgentPage(id: string): AgentPageDef | undefined {
  return AGENT_PAGES.find((a) => a.id === id);
}
