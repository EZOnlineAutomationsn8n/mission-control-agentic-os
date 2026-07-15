import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import path from "path";

export type ClaudeCodeSessionStatus = "starting" | "idle" | "running" | "stopped" | "error";

export interface ClaudeCodeSession {
  sessionKey: string;
  claudeSessionId: string;
  displayName: string;
  workspace: string;
  permissionMode: "acceptEdits";
  executionMode: "on-demand-cli";
  status: ClaudeCodeSessionStatus;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}

function dataDirectory(): string {
  return process.env.CLAUDE_CODE_SESSION_DATA_DIR || process.env.AGENT_CONVERSATION_DATA_DIR || path.join(process.cwd(), "data");
}

function sessionFile(): string {
  return path.join(dataDirectory(), "claude-code-sessions.json");
}

function workspacePath(): string {
  return process.env.CLAUDE_CODE_WORKSPACE || process.cwd();
}

async function readSessions(): Promise<Record<string, ClaudeCodeSession>> {
  try {
    return JSON.parse(await fs.readFile(sessionFile(), "utf8")) as Record<string, ClaudeCodeSession>;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

async function writeSessions(sessions: Record<string, ClaudeCodeSession>): Promise<void> {
  await fs.mkdir(dataDirectory(), { recursive: true });
  const target = sessionFile();
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(sessions, null, 2)}\n`, "utf8");
  await fs.rename(temporary, target);
}

export async function readClaudeCodeSession(sessionKey: string): Promise<ClaudeCodeSession | null> {
  return (await readSessions())[sessionKey] ?? null;
}

export async function createClaudeCodeSession(sessionKey: string): Promise<ClaudeCodeSession> {
  const sessions = await readSessions();
  const now = new Date().toISOString();
  const session: ClaudeCodeSession = {
    sessionKey,
    claudeSessionId: randomUUID(),
    displayName: `mission-control-${sessionKey}`,
    workspace: workspacePath(),
    permissionMode: "acceptEdits",
    executionMode: "on-demand-cli",
    status: "starting",
    active: true,
    createdAt: now,
    updatedAt: now,
    lastError: null,
  };
  sessions[sessionKey] = session;
  await writeSessions(sessions);
  return session;
}

export async function updateClaudeCodeSession(
  sessionKey: string,
  update: Partial<Pick<ClaudeCodeSession, "status" | "active" | "lastError">>
): Promise<ClaudeCodeSession> {
  const sessions = await readSessions();
  const current = sessions[sessionKey];
  if (!current) throw new Error("Claude Code session does not exist");
  const next: ClaudeCodeSession = { ...current, ...update, updatedAt: new Date().toISOString() };
  sessions[sessionKey] = next;
  await writeSessions(sessions);
  return next;
}

export async function stopClaudeCodeSession(sessionKey: string): Promise<ClaudeCodeSession | null> {
  const current = await readClaudeCodeSession(sessionKey);
  if (!current) return null;
  return updateClaudeCodeSession(sessionKey, { active: false, status: "stopped", lastError: null });
}
