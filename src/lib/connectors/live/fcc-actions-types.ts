// Pure type definitions — no imports, no Node built-ins. Safe to import
// (type-only) from client components without pulling server-only code into
// the browser bundle. The actual sender lives in fcc-actions.ts and is
// only ever invoked from the server-side API route.

export type FccActionStatus = "completed" | "action_required" | "failed" | "timeout";

export type FccAttemptOutcome = "completed" | "upstream_provider_failed" | "failed" | "timeout";

export interface FccModelAttempt {
  /** Position of this route in the OPERATOR-DEFINED order (1-based, stable). */
  routeNumber: number;
  /** The transport route string sent for this attempt (operator-controlled list). */
  transportModelAlias: string;
  /** The real backing model FCC reported it used for this attempt, if any. */
  actualRuntimeModel: string | null;
  outcome: FccAttemptOutcome;
  error: string | null;
  /** Wall-clock duration of this attempt in milliseconds. */
  latencyMs: number;
  /** True when this attempt was tried first because it answered last time
      (an optimization only — the operator order itself is never changed). */
  lastKnownGood?: boolean;
}

export interface FccAskResult {
  status: FccActionStatus;
  text: string | null;
  error: string | null;
  /** The route that ultimately produced `text` (or the last one tried, if all failed). */
  transportModelAlias: string;
  /** The real backing model that ultimately produced `text`, when available. */
  actualRuntimeModel: string | null;
  /** Every route attempted, in the order tried, each stamped with its operator route number. */
  attempts: FccModelAttempt[];
  /** Total number of routes in the operator-defined list. */
  routeCount: number;
  /** Operator route numbers that were NOT attempted because the chain budget ran out. */
  skippedRouteNumbers: number[];
  timestamp: string;
}
