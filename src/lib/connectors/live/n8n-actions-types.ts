export type N8nTriggerStatus = "completed" | "failed" | "blocked";

export interface N8nTriggerResult {
  status: N8nTriggerStatus;
  text: string | null;
  error: string | null;
  timestamp: string;
}
