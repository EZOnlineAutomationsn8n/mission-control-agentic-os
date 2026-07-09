export type AgyConnectorStatus = "connected" | "degraded" | "disconnected";

export interface AgyLiveStatus {
  systemId: "agy";
  label: "AGY Orchestrator";
  status: AgyConnectorStatus;
  mode: "local-http-health";
  source: string;
  healthReachable: boolean;
  httpStatus: number | null;
  service: string | null;
  /** From the safe read-only /status endpoint (registry snapshot, not job execution). */
  registryOk: boolean | null;
  agentsTotal: number | null;
  pending: number | null;
  commandExecution: false;
  outputKind: "live-status";
  lastCheckedAt: string;
  errors: string[];
}
