import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { databaseEnabled } from "@/lib/persistence/database";
import { listPersistedSessions, patchPersistedSession, readPersistedSession, upsertPersistedSession } from "@/lib/persistence/session-repository";

export type CliAgentId = "hermes" | "openclaw" | "agy" | "gemini" | "codex";
export type CliAgentSessionStatus = "starting" | "idle" | "running" | "stopped" | "error";

export interface CliAgentSession {
  sessionKey: string;
  agentId: CliAgentId;
  runtimeSessionId: string;
  displayName: string;
  workspace: string;
  permissionMode: string;
  executionMode: "on-demand-cli";
  status: CliAgentSessionStatus;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  profileId?: string | null;
  projectId?: string | null;
  role?: string | null;
  assignmentPath?: string | null;
  agentRuntime?: string | null;
  transportModelAlias?: string | null;
  actualRuntimeModel?: string | null;
}

function dataDirectory(): string {
  return process.env.CLI_AGENT_SESSION_DATA_DIR || process.env.AGENT_CONVERSATION_DATA_DIR || path.join(process.cwd(), "data");
}

function sessionFile(): string {
  return path.join(dataDirectory(), "cli-agent-sessions.json");
}

function recordKey(agentId: CliAgentId, sessionKey: string): string {
  return `${agentId}:${sessionKey}`;
}

let mutationQueue: Promise<void> = Promise.resolve();

function mutateSessions<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(() => undefined, () => undefined);
  return result;
}

function workspaceFor(agentId: CliAgentId): string {
  const projectWorkspace = process.env.MISSION_CONTROL_AGENT_WORKSPACE || process.cwd();
  if (agentId === "hermes") return process.env.HERMES_AGENT_WORKSPACE || projectWorkspace;
  if (agentId === "agy") return process.env.AGY_AGENT_WORKSPACE || projectWorkspace;
  if (agentId === "gemini") return process.env.GEMINI_AGENT_WORKSPACE || projectWorkspace;
  if (agentId === "codex") return process.env.CODEX_AGENT_WORKSPACE || projectWorkspace;
  return process.env.OPENCLAW_AGENT_WORKSPACE || projectWorkspace;
}

async function readSessions(): Promise<Record<string, CliAgentSession>> {
  try {
    return JSON.parse(await fs.readFile(sessionFile(), "utf8")) as Record<string, CliAgentSession>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeSessions(sessions: Record<string, CliAgentSession>): Promise<void> {
  await fs.mkdir(dataDirectory(), { recursive: true });
  const target = sessionFile();
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

export async function readCliAgentSession(agentId: CliAgentId, sessionKey: string): Promise<CliAgentSession | null> {
  if (databaseEnabled()) return readPersistedSession<CliAgentSession>("cli", agentId, sessionKey);
  return (await readSessions())[recordKey(agentId, sessionKey)] ?? null;
}

export async function listCliAgentSessions(agentId?: CliAgentId): Promise<CliAgentSession[]> {
  const sessions = databaseEnabled()
    ? await listPersistedSessions<CliAgentSession>("cli", agentId)
    : Object.values(await readSessions()).filter((session) => !agentId || session.agentId === agentId);
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function profileFor(agentId: CliAgentId): string {
  if (agentId === "openclaw") return process.env.OPENCLAW_AGENT_ID || "mission-control";
  return agentId;
}

function projectFor(workspace: string): string {
  return path.basename(workspace.replace(/[\\/]+$/, "")) || "unknown";
}

function roleFor(agentId: CliAgentId): string {
  if (agentId === "openclaw") return "Mission Control OpenClaw agent";
  if (agentId === "hermes") return "Mission Control Hermes agent";
  if (agentId === "agy") return "Mission Control Antigravity agent";
  if (agentId === "gemini") return "Mission Control Gemini agent";
  return "Mission Control Codex agent";
}

export async function createCliAgentSession(agentId: CliAgentId, sessionKey: string): Promise<CliAgentSession> {
  const create = async () => {
    const sessions = databaseEnabled() ? {} : await readSessions();
    const now = new Date().toISOString();
    const workspace = workspaceFor(agentId);
    const session: CliAgentSession = {
      sessionKey,
      agentId,
      runtimeSessionId: agentId === "openclaw" || agentId === "gemini" ? randomUUID() : "",
      displayName: `mission-control-${agentId}-${sessionKey}`,
      workspace,
      permissionMode: agentId === "hermes"
        ? "Hermes standard approvals"
        : agentId === "agy"
          ? "Antigravity sandbox terminal restrictions"
          : agentId === "gemini"
            ? "Gemini sandbox with in-sandbox auto approval"
            : agentId === "codex"
              ? "Codex workspace-write sandbox"
          : "OpenClaw exec policy",
      executionMode: "on-demand-cli",
      status: "starting",
      active: true,
      createdAt: now,
      updatedAt: now,
      lastError: null,
      profileId: profileFor(agentId),
      projectId: projectFor(workspace),
      role: roleFor(agentId),
      assignmentPath: null,
      agentRuntime: null,
      transportModelAlias: null,
      actualRuntimeModel: null,
    };
    if (databaseEnabled()) return upsertPersistedSession("cli", agentId, sessionKey, session);
    sessions[recordKey(agentId, sessionKey)] = session;
    await writeSessions(sessions);
    return session;
  };
  return databaseEnabled() ? create() : mutateSessions(create);
}

export async function updateCliAgentSession(
  agentId: CliAgentId,
  sessionKey: string,
  update: Partial<Pick<CliAgentSession,
    "runtimeSessionId" | "status" | "active" | "lastError" | "profileId" | "projectId" |
    "role" | "assignmentPath" | "agentRuntime" | "transportModelAlias" | "actualRuntimeModel"
  >>
): Promise<CliAgentSession> {
  if (databaseEnabled()) {
    return patchPersistedSession<CliAgentSession>("cli", agentId, sessionKey, update);
  }
  return mutateSessions(async () => {
    const sessions = await readSessions();
    const key = recordKey(agentId, sessionKey);
    const current = sessions[key];
    if (!current) throw new Error(`${agentId} session does not exist`);
    const next: CliAgentSession = { ...current, ...update, updatedAt: new Date().toISOString() };
    sessions[key] = next;
    await writeSessions(sessions);
    return next;
  });
}

export async function stopCliAgentSession(agentId: CliAgentId, sessionKey: string): Promise<CliAgentSession | null> {
  const current = await readCliAgentSession(agentId, sessionKey);
  if (!current) return null;
  return updateCliAgentSession(agentId, sessionKey, { active: false, status: "stopped", lastError: null });
}
