// Pure type definitions — no imports, no Node built-ins. Safe to import
// (type-only) from client components without pulling server-only code into
// the browser bundle. The actual sender lives in fcc-actions.ts and is
// only ever invoked from the server-side API route.

export type FccActionStatus = "completed" | "action_required" | "failed" | "timeout";

export type FccAttemptOutcome = "completed" | "upstream_provider_failed" | "failed" | "timeout";

export interface FccModelAttempt {
  /** The Claude-style/gateway model string sent for this attempt. */
  transportModelAlias: string;
  /** The real backing model FCC reported it used for this attempt, if any. */
  actualRuntimeModel: string | null;
  outcome: FccAttemptOutcome;
  error: string | null;
}

export interface FccAskResult {
  status: FccActionStatus;
  text: string | null;
  error: string | null;
  /** The route that ultimately produced `text` (or the last one tried, if all failed). */
  transportModelAlias: string;
  /** The real backing model that ultimately produced `text`, when available. */
  actualRuntimeModel: string | null;
  /** Every model route attempted, in order, with its individual outcome. */
  attempts: FccModelAttempt[];
  timestamp: string;
}
