// Pure type definitions — no imports, no Node built-ins. Safe to import
// (type-only) from client components without pulling server-only code into
// the browser bundle. The actual reader lives in openclaw-status.ts and is
// only ever invoked from the server-side API route.

export type OpenClawConnectorStatus = "unknown" | "connected" | "degraded" | "disconnected";

export interface OpenClawLiveStatus {
  systemId: "openclaw";
  label: "OpenClaw";
  status: OpenClawConnectorStatus;
  mode: "local-gateway-status" | "remote-gateway-status";
  source: string;
  service: string;
  gatewayReachable: boolean;
  httpStatus: number | null;
  pidAlive: boolean | null;
  commandExecution: false;
  outputKind: "live-status";
  /** Static declarative field — this reader never inspects or reactivates the heartbeat loop. */
  heartbeat: "disabled" | "unknown";
  /** Static declarative field — this reader never opens/reads any session content. */
  oldMainSession: "untouched";
  lastCheckedAt: string;
  errors: string[];
}
