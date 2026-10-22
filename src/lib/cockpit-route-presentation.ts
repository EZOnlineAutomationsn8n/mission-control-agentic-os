import type { CockpitAgentId, CockpitAgentTarget } from "@/lib/cockpit/agent-registry";

export type CockpitRouteType = "NORMAL" | "LOCAL";
export type CockpitRouteStatus =
  | "CONFIGURED"
  | "CERTIFIED"
  | "CONNECTED"
  | "READY_TO_USE"
  | "BLOCKED"
  | "UNKNOWN";

export interface CockpitRoutePresentation {
  targetId: CockpitAgentId;
  routeType: CockpitRouteType;
  runtimeIdentity: string;
  configuredProvider: string | null;
  configuredModel: string | null;
  routeStatus: CockpitRouteStatus;
  routeStatusDetail: string;
  certificationRef: string | null;
}

const FOUR_RUNTIME_CERTIFICATION_REF =
  "docs/operations/MC_FOUR_RUNTIME_LAUNCH_AND_IDENTITY_RECONCILIATION_013_20261003/LIVE_CERTIFICATION_CHECKPOINT_20261007.md";

const NORMAL_ROUTE_PRESENTATION: Record<CockpitAgentId, CockpitRoutePresentation> = {
  "claude-code": {
    targetId: "claude-code",
    routeType: "NORMAL",
    runtimeIdentity: "Claude Code CLI",
    configuredProvider: null,
    configuredModel: null,
    routeStatus: "CERTIFIED",
    routeStatusDetail:
      "Current normal Claude Code route is certified. Provider/model remain per-turn transport evidence and are not hard-coded.",
    certificationRef: FOUR_RUNTIME_CERTIFICATION_REF,
  },
  hermes: {
    targetId: "hermes",
    routeType: "NORMAL",
    runtimeIdentity: "Hermes Agent CLI",
    configuredProvider: null,
    configuredModel: null,
    routeStatus: "CERTIFIED",
    routeStatusDetail:
      "Current normal Hermes route is certified. Provider/model are observed from runtime/turn evidence and may change independently of agent identity.",
    certificationRef: FOUR_RUNTIME_CERTIFICATION_REF,
  },
  openclaw: {
    targetId: "openclaw",
    routeType: "NORMAL",
    runtimeIdentity: "OpenClaw CLI agent route",
    configuredProvider: null,
    configuredModel: null,
    routeStatus: "CERTIFIED",
    routeStatusDetail:
      "Current normal OpenClaw route is certified. Provider/model are taken from observed agent metadata when available.",
    certificationRef: FOUR_RUNTIME_CERTIFICATION_REF,
  },
  antigravity: {
    targetId: "antigravity",
    routeType: "NORMAL",
    runtimeIdentity: "Antigravity CLI",
    configuredProvider: null,
    configuredModel: null,
    routeStatus: "CERTIFIED",
    routeStatusDetail:
      "Current normal Antigravity route is certified. Provider/model are not inferred from the agent identity.",
    certificationRef: FOUR_RUNTIME_CERTIFICATION_REF,
  },
  gemini: {
    targetId: "gemini",
    routeType: "NORMAL",
    runtimeIdentity: "Gemini CLI",
    configuredProvider: null,
    configuredModel: null,
    routeStatus: "CONFIGURED",
    routeStatusDetail:
      "Mission Control wiring exists, but no current cockpit route certification is bound to this target.",
    certificationRef: null,
  },
  codex: {
    targetId: "codex",
    routeType: "NORMAL",
    runtimeIdentity: "Codex CLI",
    configuredProvider: null,
    configuredModel: null,
    routeStatus: "CONFIGURED",
    routeStatusDetail:
      "Mission Control wiring exists, but no current cockpit route certification is bound to this target.",
    certificationRef: null,
  },
};

/**
 * Schema/gate for future LOCAL targets. This is presentation metadata only:
 * it is not an agent registry entry, session owner, connector, or pane.
 */
export const LOCAL_ROUTE_PRESENTATION_CONTRACT = {
  routeType: "LOCAL" as const,
  requiredVisibleFields: [
    "AGENT",
    "ROUTE_TYPE",
    "RUNTIME",
    "PROVIDER",
    "MODEL",
    "ROUTE_STATUS",
  ] as const,
  allowedStatuses: [
    "CONFIGURED",
    "CERTIFIED",
    "CONNECTED",
    "READY_TO_USE",
    "BLOCKED",
    "UNKNOWN",
  ] as const,
  registrationStatus: "BLOCKED" as CockpitRouteStatus,
  registrationGate:
    "No LOCAL agent target may be registered until an exact durable upstream certification proves the agent route, runtime selector, provider/model, continuity and failure semantics. Ollama availability alone is insufficient.",
  ollamaRole: "MODEL_PROVIDER_NOT_AGENT" as const,
};

export function getCockpitRoutePresentation(
  target: Pick<CockpitAgentTarget, "id" | "runtimeFallback">
): CockpitRoutePresentation {
  return NORMAL_ROUTE_PRESENTATION[target.id] ?? {
    targetId: target.id,
    routeType: "NORMAL",
    runtimeIdentity: target.runtimeFallback,
    configuredProvider: null,
    configuredModel: null,
    routeStatus: "UNKNOWN",
    routeStatusDetail: "No route presentation evidence is bound to this target.",
    certificationRef: null,
  };
}
