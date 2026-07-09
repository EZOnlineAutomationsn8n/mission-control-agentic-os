// Pure type definitions — no imports, no Node built-ins. Safe to import
// (type-only) from client components without pulling server-only code into
// the browser bundle. The actual reader lives in paperclip-status.ts and is
// only ever invoked from the server-side API route.

export type PaperclipConnectorStatus = "connected" | "degraded" | "disconnected";

export interface PaperclipLiveStatus {
  systemId: "paperclip";
  label: "Paperclip";
  status: PaperclipConnectorStatus;
  mode: "local-http-health";
  source: string;
  healthReachable: boolean;
  httpStatus: number | null;
  bootstrapStatus: string | null;
  deploymentMode: string | null;
  pidAlive: boolean;
  commandExecution: false;
  outputKind: "live-status";
  lastCheckedAt: string;
  errors: string[];
}
