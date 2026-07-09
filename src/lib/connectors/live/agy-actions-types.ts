export type AgyActionStatus = "completed" | "failed" | "blocked";

export interface AgyContextResult {
  status: AgyActionStatus;
  text: string | null;
  error: string | null;
  timestamp: string;
}
