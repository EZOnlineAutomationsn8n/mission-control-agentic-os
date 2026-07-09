// Pure type definitions — no imports, no Node built-ins. Safe to import
// (type-only) from client components without pulling `fs`/`path` into the
// browser bundle. The actual reader that touches the filesystem lives in
// hermes-status.ts and is only ever invoked from the server-side API route.

export type HermesConnectorStatus = "connected" | "degraded" | "disconnected";

export interface HermesLiveStatus {
  systemId: "hermes";
  label: "Hermes";
  status: HermesConnectorStatus;
  mode: "gateway";
  source: string;
  pid: number | null;
  pidAlive: boolean;
  gatewayState: string;
  platforms: string[];
  activeAgents: string[];
  provider: string;
  defaultModel: string;
  version: string;
  contractStatus: string;
  commandExecution: false;
  lastCheckedAt: string;
  errors: string[];
}
