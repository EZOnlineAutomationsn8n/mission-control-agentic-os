// Pure type definitions — no imports, no Node built-ins. Safe to import
// (type-only) from client components without pulling server-only code into
// the browser bundle. The actual reader lives in fcc-status.ts and is only
// ever invoked from the server-side API route.

export type FccConnectorStatus = "unknown" | "connected" | "degraded" | "disconnected";

export interface FccLiveStatus {
  systemId: "claude-fcc";
  label: "FCC Model Gateway";
  status: FccConnectorStatus;
  mode: "local-http-health";
  source: string;
  healthReachable: boolean;
  httpStatus: number | null;
  service: string;
  provider: string;
  modelRoute: string;
  commandExecution: false;
  outputKind: "live-status";
  lastCheckedAt: string;
  errors: string[];
}
