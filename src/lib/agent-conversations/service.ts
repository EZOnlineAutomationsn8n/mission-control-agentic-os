import { randomUUID } from "crypto";
import { appendAuditEvent } from "@/lib/audit-log-store";
import { appendConversationEntry } from "./store";
import type { AgentConversationEntry, AgentConversationResult, ConversationStatus } from "./types";
import type { AttachmentReference } from "@/lib/attachments/types";
import { auditInitiatorFields, type ConversationInitiator } from "./initiator";

export interface ConnectorConversationResult {
  status: ConversationStatus;
  text: string | null;
  error: string | null;
  transportModelAlias?: string;
  actualRuntimeModel?: string | null;
  attempts?: AgentConversationEntry["attempts"];
  routeCount?: number;
  skippedRouteNumbers?: number[];
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
}

export async function executeConversationRequest(options: {
  agentId: string;
  sessionId: string;
  prompt: string;
  attachments?: AttachmentReference[];
  actionType: string;
  initiator?: ConversationInitiator;
  run: () => Promise<ConnectorConversationResult>;
}): Promise<AgentConversationResult> {
  const createdAt = new Date().toISOString();
  const started = Date.now();
  let connectorResult: ConnectorConversationResult;
  try {
    connectorResult = await options.run();
  } catch (error) {
    connectorResult = {
      status: "failed",
      text: null,
      error: error instanceof Error ? error.message : "connector request failed",
    };
  }

  const entry: AgentConversationEntry = {
    id: randomUUID(),
    agentId: options.agentId,
    sessionId: options.sessionId,
    prompt: options.prompt,
    attachments: options.attachments ?? [],
    status: connectorResult.status,
    text: connectorResult.text,
    error: connectorResult.error,
    transportModelAlias: connectorResult.transportModelAlias ?? null,
    actualRuntimeModel: connectorResult.actualRuntimeModel ?? null,
    attempts: connectorResult.attempts ?? [],
    routeCount: connectorResult.routeCount ?? null,
    skippedRouteNumbers: connectorResult.skippedRouteNumbers ?? [],
    durationMs: Date.now() - started,
    createdAt,
    completedAt: new Date().toISOString(),
    agentIdentity: connectorResult.agentIdentity ?? null,
    agentRuntime: connectorResult.agentRuntime ?? null,
    installedVersion: connectorResult.installedVersion ?? null,
    provider: connectorResult.provider ?? null,
    runtimeVerifiedAt: connectorResult.runtimeVerifiedAt ?? null,
    responseProvenance: connectorResult.responseProvenance ?? null,
    agentSessionId: connectorResult.agentSessionId ?? null,
    workspace: connectorResult.workspace ?? null,
    sessionState: connectorResult.sessionState ?? null,
    executionMode: connectorResult.executionMode ?? null,
    permissionMode: connectorResult.permissionMode ?? null,
    ...(options.initiator ? { initiator: options.initiator, initiatorVerified: false as const } : {}),
  };
  await appendConversationEntry(entry);

  const summary = entry.status === "completed"
    ? entry.agentSessionId
      ? `${entry.durationMs}ms  ${entry.agentIdentity ?? "agent"}  session ${entry.agentSessionId}  ${entry.transportModelAlias ?? "gateway model unknown"}  attachments ${(entry.attachments ?? []).length}`
      : `${entry.durationMs}ms  route ${entry.attempts.find((attempt) => attempt.outcome === "completed")?.routeNumber ?? "unknown"}  ${entry.actualRuntimeModel ?? entry.transportModelAlias ?? "model unknown"}`
    : `${entry.durationMs}ms  ${entry.error ?? "request did not complete"}`;
  const audit = await appendAuditEvent({
    timestamp: entry.completedAt,
    connectorId: entry.agentId,
    actionType: options.actionType,
    status: entry.status,
    resultSummary: summary,
    ...auditInitiatorFields(options.initiator ?? null),
    source: "agent-conversations/service.ts:executeConversationRequest",
  });

  return { entry, auditRecorded: audit.ok, auditError: audit.error ?? null };
}
