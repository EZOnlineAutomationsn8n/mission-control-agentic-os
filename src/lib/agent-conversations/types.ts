export type ConversationStatus = "completed" | "action_required" | "failed" | "timeout";

export interface ConversationAttempt {
  routeNumber?: number;
  transportModelAlias: string;
  actualRuntimeModel: string | null;
  outcome: string;
  error: string | null;
  latencyMs?: number;
  lastKnownGood?: boolean;
}

export interface AgentConversationEntry {
  id: string;
  agentId: string;
  sessionId: string;
  prompt: string;
  status: ConversationStatus;
  text: string | null;
  error: string | null;
  transportModelAlias: string | null;
  actualRuntimeModel: string | null;
  attempts: ConversationAttempt[];
  routeCount: number | null;
  skippedRouteNumbers: number[];
  durationMs: number;
  createdAt: string;
  completedAt: string;
}

export interface AgentConversationResult {
  entry: AgentConversationEntry;
  auditRecorded: boolean;
  auditError: string | null;
}
