import { randomUUID } from "crypto";
import type { DisposableFixtureOwnership } from "./disposable-fixture-cleanup";
import { promises as fs } from "fs";
import path from "path";
import { databaseEnabled } from "@/lib/persistence/database";
import { insertPersistedFixtureSession, listPersistedSessions, patchPersistedSession, readPersistedSession, upsertPersistedSession } from "@/lib/persistence/session-repository";

export type ClaudeCodeSessionStatus = "prepared" | "starting" | "idle" | "running" | "stopped" | "error";

export interface ClaudeCodeSession {
  sessionKey: string;
  claudeSessionId: string;
  displayName: string;
  workspace: string;
  permissionMode: "acceptEdits" | "plan";
  executionMode: "on-demand-cli";
  status: ClaudeCodeSessionStatus;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
  disposableFixture?: DisposableFixtureOwnership;
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

/** Cooperative, fail-closed file-store writer lock shared by ALL session mutations. */
async function withFileSessionLock<T>(operation: () => Promise<T>): Promise<T> {
  await fs.mkdir(dataDirectory(), { recursive: true });
  const lock = path.join(dataDirectory(), ".claude-code-sessions.write-lock");
  await fs.mkdir(lock); // EEXIST fails closed; never break stale locks automatically.
  try { return await operation(); } finally { await fs.rmdir(lock); }
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
  if (databaseEnabled()) return readPersistedSession<ClaudeCodeSession>("claude-code", "claude-code", sessionKey);
  return (await readSessions())[sessionKey] ?? null;
}

export async function listClaudeCodeSessions(): Promise<ClaudeCodeSession[]> {
  const sessions = databaseEnabled()
    ? await listPersistedSessions<ClaudeCodeSession>("claude-code", "claude-code")
    : Object.values(await readSessions());
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createClaudeCodeSession(sessionKey: string, fixture?: { originatingOrderId: string; fixtureId: string; owner: "DENNIS"; project: "MISSION_CONTROL_AGENTIC_OS" }): Promise<ClaudeCodeSession> {
  if (fixture && (!fixture.originatingOrderId.startsWith("MC-") || !fixture.fixtureId || fixture.owner !== "DENNIS" || fixture.project !== "MISSION_CONTROL_AGENTIC_OS")) throw new Error("invalid internal disposable fixture provenance");
  if (fixture && await readClaudeCodeSession(sessionKey)) throw new Error("disposable fixture session key must be new");
  if (databaseEnabled()) {
    const now = new Date().toISOString();
    const id = randomUUID();
    const item: ClaudeCodeSession = {sessionKey, claudeSessionId:id, displayName:`mission-control-${sessionKey}`, workspace: workspacePath(), permissionMode:"acceptEdits",executionMode:"on-demand-cli",status:"starting",active:true,createdAt:now,updatedAt:now,lastError:null,
      ...(fixture ? {disposableFixture:{kind:"mission-control-claude-disposable-cert-v1" as const,owner:fixture.owner,project:fixture.project,originatingOrderId:fixture.originatingOrderId,fixtureId:fixture.fixtureId,sessionKey,nativeSessionId:id,createdAt:now}} : {})};
    return fixture ? insertPersistedFixtureSession(sessionKey,item) : upsertPersistedSession("claude-code","claude-code",sessionKey,item);
  }
  return withFileSessionLock(async () => {
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
    ...(fixture ? { disposableFixture: { kind: "mission-control-claude-disposable-cert-v1" as const, owner: fixture.owner, project: fixture.project, originatingOrderId: fixture.originatingOrderId, fixtureId: fixture.fixtureId, sessionKey, nativeSessionId: "", createdAt: now } } : {}),
  };
  if (session.disposableFixture) session.disposableFixture.nativeSessionId = session.claudeSessionId;

  if (fixture && sessions[sessionKey]) throw new Error("disposable fixture session key already exists");
  sessions[sessionKey] = session;
  await writeSessions(sessions);
  return session;
  });
}

export async function updateClaudeCodeSession(
  sessionKey: string,
  update: Partial<Pick<ClaudeCodeSession, "status" | "active" | "lastError">>
): Promise<ClaudeCodeSession> {
  if (databaseEnabled()) {
    return patchPersistedSession<ClaudeCodeSession>("claude-code", "claude-code", sessionKey, update);
  }
  return withFileSessionLock(async () => {
  const sessions = await readSessions();
  const current = sessions[sessionKey];
  if (!current) throw new Error("Claude Code session does not exist");
  const next: ClaudeCodeSession = { ...current, ...update, updatedAt: new Date().toISOString() };
  sessions[sessionKey] = next;
  await writeSessions(sessions);
  return next;
  });
}

export async function stopClaudeCodeSession(sessionKey: string): Promise<ClaudeCodeSession | null> {
  const current = await readClaudeCodeSession(sessionKey);
  if (!current) return null;
  return updateClaudeCodeSession(sessionKey, { active: false, status: "stopped", lastError: null });
}


/**
 * ACF Werkplaats registration only. No Claude CLI is spawned, no FCC
 * preflight occurs, and no native transcript is invented. The session is
 * explicitly PREPARED and excluded from ACF ready-idle eligibility.
 * Existing registration and native identity are never overwritten.
 */
export async function prepareClaudeAfcStageSession(sessionKey="acf-werkplaats-claude-code"):Promise<ClaudeCodeSession>{
  if(process.env.MC_PREVIEW!=="1"||process.env.GAOS_STAGE_NATIVE_ISOLATED!=="1"||
    sessionKey!=="acf-werkplaats-claude-code"||databaseEnabled()||
    !path.resolve(process.cwd()).endsWith("/.stage-achtergrond")||
    path.resolve(dataDirectory())!==path.join(path.resolve(process.cwd()),"data")){
    throw new Error("CLAUDE_ACF_STAGE_PREPARE_NOT_ISOLATED");
  }
  const existing=await readClaudeCodeSession(sessionKey);
  if(existing)return existing;
  const newSession=await createClaudeCodeSession(sessionKey);
  return updateClaudeCodeSession(newSession.sessionKey,{
    status:"prepared",active:true,
    lastError:"FCC_STAGE_NATIVE_GUARD_NOT_EFFECTIVE; native bootstrap not run",
  });
}
