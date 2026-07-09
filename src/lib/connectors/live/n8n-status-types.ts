export type N8nConnectorStatus = "connected" | "degraded" | "disconnected";

export interface N8nLiveStatus {
  systemId: "n8n";
  label: "n8n";
  status: N8nConnectorStatus;
  mode: "local-http-health";
  source: string;
  healthReachable: boolean;
  httpStatus: number | null;
  commandExecution: false;
  outputKind: "live-status";
  lastCheckedAt: string;
  errors: string[];
}
