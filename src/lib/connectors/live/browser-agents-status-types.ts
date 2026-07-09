// Pure type definitions — no imports, no Node built-ins. Safe to import
// (type-only) from client components without pulling server-only code into
// the browser bundle. The actual reader lives in browser-agents-status.ts
// and is only ever invoked from the server-side API route.

export type BrowserAgentsConnectorStatus = "connected" | "degraded" | "disconnected";

export interface BrowserAgentsLiveStatus {
  systemId: "browser-agents";
  label: "Browser Agents";
  status: BrowserAgentsConnectorStatus;
  mode: "local-cdp-probe";
  source: string;
  cdpReachable: boolean;
  cdpVersion: string | null;
  cdpWebSocketDebuggerUrl: string | null;
  profilePathExists: boolean;
  commandExecution: false;
  outputKind: "live-status";
  lastCheckedAt: string;
  errors: string[];
}
