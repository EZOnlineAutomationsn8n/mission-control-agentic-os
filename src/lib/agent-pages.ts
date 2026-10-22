import { COCKPIT_AGENT_TARGETS } from "@/lib/cockpit/agent-registry";

export interface AgentPageDef {
  id: string;
  name: string;
  connectorId: string | null;
  missing: string | null;
  plannedTabs: string[];
  detected: string;
}

const COCKPIT_PAGES: AgentPageDef[] = COCKPIT_AGENT_TARGETS.map((target) => ({
  id: target.pageId,
  name: target.label,
  connectorId: target.connectorId,
  missing: null,
  plannedTabs: [...target.plannedTabs],
  detected: target.detected,
}));

export const AGENT_PAGES: AgentPageDef[] = [
  ...COCKPIT_PAGES,
  {
    id: "kimi-code", name: "Kimi Code", connectorId: null,
    missing: "Kimi Code CLI/API is not detected on this host.", plannedTabs: ["Chat", "Sessions"],
    detected: "No Kimi executable or provider route is proven on this host.",
  },
  {
    id: "glm-5-2", name: "GLM 5.2", connectorId: null,
    missing: "No separate GLM provider route is configured.", plannedTabs: ["Chat"],
    detected: "No local GLM agent runtime is proven on this host.",
  },
];

export function getAgentPage(id: string): AgentPageDef | undefined {
  return AGENT_PAGES.find((agent) => agent.id === id);
}
