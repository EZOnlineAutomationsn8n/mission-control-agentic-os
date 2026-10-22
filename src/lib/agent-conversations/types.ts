import type { AttachmentReference } from "@/lib/attachments/types";
import type { ConversationInitiator } from "./initiator";

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
  attachments?: AttachmentReference[];
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
  agentIdentity?: string | null;
  agentRuntime?: string | null;
  installedVersion?: string | null;
  provider?: string | null;
  runtimeVerifiedAt?: string | null;
  responseProvenance?: string | null;
  agentSessionId?: string | null;
  workspace?: string | null;
  sessionState?: string | null;
  executionMode?: string | null;
  permissionMode?: string | null;
  initiator?: ConversationInitiator;
  initiatorVerified?: false;
}

export interface AgentConversationResult {
  entry: AgentConversationEntry;
  auditRecorded: boolean;
  auditError: string | null;
}
