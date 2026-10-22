import type { CockpitSessionSummary } from "./agent-registry";
import { getCockpitAgentByApiId } from "./agent-registry";
import { listClaudeCodeSessions } from "@/lib/claude-code/session-store";
import { listCliAgentSessions } from "@/lib/cli-agents/session-store";

export async function listCockpitSessions(): Promise<CockpitSessionSummary[]> {
  const [claudeSessions, cliSessions] = await Promise.all([
    listClaudeCodeSessions(),
    listCliAgentSessions(),
  ]);

  const normalized: CockpitSessionSummary[] = [];
  for (const session of claudeSessions) {
    const target = getCockpitAgentByApiId("claude-code");
    if (!target) continue;
    normalized.push({
      targetId: target.id, agentId: target.apiAgentId, sessionId: session.sessionKey,
      runtimeSessionId: session.claudeSessionId, displayName: session.displayName,
      workspace: session.workspace, permissionMode: session.permissionMode, executionMode: session.executionMode,
      status: session.status, active: session.active, createdAt: session.createdAt, updatedAt: session.updatedAt,
      lastError: session.lastError, profileId: null, projectId: null, role: null, assignmentPath: null,
      agentRuntime: null, transportModelAlias: null, actualRuntimeModel: null,
    });
  }
  for (const session of cliSessions) {
    const target = getCockpitAgentByApiId(session.agentId);
    if (!target) continue;
    normalized.push({
      targetId: target.id, agentId: target.apiAgentId, sessionId: session.sessionKey,
      runtimeSessionId: session.runtimeSessionId || null, displayName: session.displayName,
      workspace: session.workspace, permissionMode: session.permissionMode, executionMode: session.executionMode,
      status: session.status, active: session.active, createdAt: session.createdAt, updatedAt: session.updatedAt,
      lastError: session.lastError, profileId: session.profileId ?? null, projectId: session.projectId ?? null,
      role: session.role ?? null, assignmentPath: session.assignmentPath ?? null, agentRuntime: session.agentRuntime ?? null,
      transportModelAlias: session.transportModelAlias ?? null, actualRuntimeModel: session.actualRuntimeModel ?? null,
    });
  }
  return normalized.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
