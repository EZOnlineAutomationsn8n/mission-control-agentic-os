import { execFile } from "child_process";
import { observeDisposableClaudeChild } from "./disposable-fixture-child-observer";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { ConnectorConversationResult } from "@/lib/agent-conversations/service";
import type { ClaudeCodeSession } from "./session-store";
import { FALLBACK_MODEL_ROUTES, sendFccControlledPrompt, stageFccPreDispatchVerdict } from "@/lib/connectors/live/fcc-actions";
import type { FccModelAttempt } from "@/lib/connectors/live/fcc-actions-types";

const execFileAsync = promisify(execFile);
const DEFAULT_LAUNCHER = "/runtime/bin/start-claude-fcc.sh";
function toGatewayModel(route: string): string {
  return `claude-3-freecc-no-thinking/${route}`;
}
const IDENTITY_CONTEXT =
  "You are the Claude Code agent running inside the Mission Control Claude Code Agent Terminal. " +
  "Your agent identity is Claude Code. FCC is only the underlying model gateway. " +
  "Never present a backing fallback model as your agent identity. FCC is provider-agnostic and may route to non-Anthropic models. " +
  "The Claude Code CLI does not report the actual backing runtime model here, so call it unknown unless explicit machine-readable evidence is provided. " +
  "Distinguish agent identity, CLI runtime, FCC gateway alias, and backing model. " +
  "Use the Mission Control CLAUDE.md as your runtime working protocol. Do not import OpenClaw or other runtime-specific AGENTS.md rules unless the current Dennis work order explicitly names them.";

interface ClaudeCliPayload {
  type?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  modelUsage?: Record<string, unknown>;
  permission_denials?: unknown[];
}

export interface ClaudeCodeTurnResult extends ConnectorConversationResult {
  cliPayload: ClaudeCliPayload;
}

interface NativeClaudeSessionSnapshot {
  filePath: string | null;
  size: number;
  mtimeMs: number;
}

async function nativeClaudeSessionSnapshot(sessionId: string): Promise<NativeClaudeSessionSnapshot> {
  const projectsRoot = path.join(os.homedir(), ".claude", "projects");
  let projectDirs;
  try {
    projectDirs = await fs.readdir(projectsRoot, { withFileTypes: true });
  } catch {
    return { filePath: null, size: 0, mtimeMs: 0 };
  }
  for (const entry of projectDirs) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(projectsRoot, entry.name, `${sessionId}.jsonl`);
    try {
      const stat = await fs.stat(filePath);
      return { filePath, size: stat.size, mtimeMs: stat.mtimeMs };
    } catch {
      continue;
    }
  }
  return { filePath: null, size: 0, mtimeMs: 0 };
}

// MC-CLAUDE-CONTINUOUS-CONVERSATION (ACF-MC-CONTINUOUS-CONVERSATION-RECOVERY-20261020-001):
// a failed route that only appended the operator's own prompt (and session metadata) to the native transcript has
// executed nothing: no assistant output, no tool call, no tool result. Rerouting is then safe and preserves
// exactly-once. Any assistant/tool entry, or an unreadable change, keeps the strict suppression.
async function nativeChangeWasPromptOnly(
  before: NativeClaudeSessionSnapshot,
  after: NativeClaudeSessionSnapshot
): Promise<boolean> {
  if (!after.filePath || (before.filePath && before.filePath !== after.filePath)) return false;
  if (after.size < before.size) return false;
  let appended: string;
  try {
    const handle = await fs.open(after.filePath, "r");
    try {
      const length = after.size - (before.filePath ? before.size : 0);
      if (length <= 0 || length > 2 * 1024 * 1024) return false;
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, before.filePath ? before.size : 0);
      appended = buffer.toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return false;
  }
  const lines = appended.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) return false;
  for (const line of lines) {
    let entry: { type?: unknown; message?: { role?: unknown; content?: unknown } };
    try {
      entry = JSON.parse(line);
    } catch {
      return false;
    }
    const kind = typeof entry.type === "string" ? entry.type : "";
    if (!kind) return false; // an entry of unknown kind is never assumed harmless
    // Assistant TEXT (an answer or the CLI's own API-error message) has no side effects; observed live 2026-10-20:
    // the CLI writes provider errors as assistant text. Only a tool call or tool result means work was executed.
    const content = entry.message?.content;
    if (Array.isArray(content) && content.some((part) => {
      const t = (part as { type?: unknown })?.type;
      return t === "tool_use" || t === "tool_result";
    })) return false;
    // Any other entry type is CLI session metadata (custom-title, agent-name, queue-operation, attachment,
    // atis-latch, last-prompt, cost-state, summary, ...; observed live 2026-10-20). Only assistant output or a tool
    // call/result means something was executed.
  }
  return true;
}

function nativeClaudeSessionChanged(
  before: NativeClaudeSessionSnapshot,
  after: NativeClaudeSessionSnapshot
): boolean {
  return before.filePath !== after.filePath || before.size !== after.size || before.mtimeMs !== after.mtimeMs;
}

function parseResult(stdout: string): ClaudeCliPayload {
  const candidates = stdout.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("{"));
  for (const candidate of candidates.reverse()) {
    try {
      const parsed = JSON.parse(candidate) as ClaudeCliPayload;
      if (parsed.type === "result") return parsed;
    } catch {
      // Continue until the final Claude Code result object is found.
    }
  }
  throw new Error("Claude Code CLI returned no machine-readable result");
}

export async function runClaudeCodeTurn(options: {
  session: ClaudeCodeSession;
  prompt: string;
  create: boolean;
}): Promise<ClaudeCodeTurnResult> {
  // This is the actual native child boundary. Even --version and route
  // readiness are downstream; no preview may reach a provider or launcher
  // while the FCC stage gateway guard is only offline-source certified.
  const stageGuard=stageFccPreDispatchVerdict();
  if(!stageGuard.canDispatch)throw new Error(stageGuard.code);
  const launcher = process.env.CLAUDE_CODE_LAUNCHER || DEFAULT_LAUNCHER;
  const launcherPrefix = process.env.CLAUDE_CODE_LAUNCHER_ARGS_JSON
    ? JSON.parse(process.env.CLAUDE_CODE_LAUNCHER_ARGS_JSON) as unknown
    : [];
  if (!Array.isArray(launcherPrefix) || launcherPrefix.some((value) => typeof value !== "string")) {
    throw new Error("CLAUDE_CODE_LAUNCHER_ARGS_JSON must be a JSON array of strings");
  }
  const runtimeVerifiedAt = new Date().toISOString();
  const versionProbe = await execFileAsync(launcher, [...launcherPrefix, "--version"], {
    cwd: options.session.workspace,
    env: { ...process.env, CLAUDE_WORKDIR: options.session.workspace, CLAUDE_BARE: "0", CLAUDE_QUIET: "1" },
    timeout: 20_000, maxBuffer: 1024 * 1024, encoding: "utf8",
  }).catch(() => null);
  const installedVersion = versionProbe ? String(versionProbe.stdout).trim() || null : null;
  const routeReadiness = process.env.CLAUDE_CODE_SKIP_ROUTE_PREFLIGHT === "1"
    ? {
        status: "completed" as const,
        transportModelAlias: FALLBACK_MODEL_ROUTES[0],
        attempts: [],
        routeCount: FALLBACK_MODEL_ROUTES.length,
        skippedRouteNumbers: [],
        error: null,
      }
    : await sendFccControlledPrompt("Return exactly: FCC_CLAUDE_ROUTE_READY");
  const routeAttempts: FccModelAttempt[] = routeReadiness.attempts
    .filter((attempt) => attempt.outcome !== "completed")
    .map((attempt) => ({
    ...attempt,
    actualRuntimeModel: null,
  }));
  if (routeReadiness.status !== "completed") {
    return {
      status: routeReadiness.status,
      text: null,
      error: routeReadiness.error || "no FCC route was ready for Claude Code",
      transportModelAlias: toGatewayModel(routeReadiness.transportModelAlias),
      actualRuntimeModel: null,
      attempts: routeAttempts,
      routeCount: routeReadiness.routeCount,
      skippedRouteNumbers: routeReadiness.skippedRouteNumbers,
      agentIdentity: "Claude Code",
      agentRuntime: "Claude Code CLI",
      installedVersion,
      provider: null,
      runtimeVerifiedAt,
      responseProvenance: "Claude Code CLI -> FCC transport route -> persistent Claude Code session; backing model only when machine-readable",
      agentSessionId: options.session.claudeSessionId,
      workspace: options.session.workspace,
      sessionState: "error",
      executionMode: options.session.executionMode,
      permissionMode: options.session.permissionMode,
      cliPayload: {},
    };
  }
  // Only a HARD preflight failure demotes a route. A short preflight timeout (8 s) only means the free model was
  // slow; the real turn gives each route CLAUDE_CODE_ROUTE_TIMEOUT_MS (45 s). The operator route order stays 1..N.
  const preflightFailures = new Set(
    routeReadiness.attempts
      .filter((attempt) => attempt.outcome === "failed")
      .map((attempt) => attempt.transportModelAlias)
  );
  const routes = FALLBACK_MODEL_ROUTES.filter(
    (route) => route === routeReadiness.transportModelAlias || !preflightFailures.has(route)
  );
  const attempts = [...routeAttempts];
  // Free FCC routes regularly need 40-60 s for a turn (observed live 2026-10-20: an answer landed at 45.0 s and was
  // cut off). Defaults widened; both stay overridable by environment.
  const totalTimeoutMs = Number(process.env.CLAUDE_CODE_TIMEOUT_MS || 300_000);
  const perRouteTimeoutMs = Number(process.env.CLAUDE_CODE_ROUTE_TIMEOUT_MS || 120_000);
  const startedAt = Date.now();
  let createSession = options.create;
  let lastPayload: ClaudeCliPayload = {};
  let lastError = "all Claude Code agent routes failed";
  let retrySuppressed = false;

  for (const route of routes) {
    const remainingMs = totalTimeoutMs - (Date.now() - startedAt);
    if (remainingMs < 1_000) break;
    const routeNumber = FALLBACK_MODEL_ROUTES.indexOf(route) + 1;
    const gatewayModel = toGatewayModel(route);
    const attemptStartedAt = Date.now();
    const args = [
      "--print", "--output-format", "json",
      "--name", options.session.displayName,
      "--setting-sources", "user,project,local",
      "--permission-mode", options.session.permissionMode,
      "--add-dir", options.session.workspace,
      "--append-system-prompt", IDENTITY_CONTEXT,
      // Claude Code 2.1.288 validates explicit --model values before the FCC
      // proxy can resolve them. The launcher already maps CLAUDE_MODEL to
      // ANTHROPIC_MODEL for FCC, so keep the selected route in the environment
      // and do not feed the synthetic FCC alias through the CLI validator.
      createSession ? "--session-id" : "--resume", options.session.claudeSessionId,
      options.prompt,
    ];

    const nativeBefore = await nativeClaudeSessionSnapshot(options.session.claudeSessionId);
    let payload: ClaudeCliPayload;
    try {
      const childEnv = {
        ...process.env,
        CLAUDE_WORKDIR: options.session.workspace,
        CLAUDE_BARE: "0",
        CLAUDE_QUIET: "1",
        CLAUDE_MODEL: process.env.CLAUDE_CODE_MODEL || gatewayModel,
      };
      const timeoutMs = Math.min(perRouteTimeoutMs, remainingMs);
      const { stdout } = options.session.disposableFixture
        ? await (async () => {
            const observed = await observeDisposableClaudeChild({session:options.session,command:launcher,args:[...launcherPrefix,...args],cwd:options.session.workspace,env:childEnv,timeoutMs,maxBytes:10*1024*1024});
            if (!observed.completed) throw new Error(`disposable fixture native child did not complete: ${observed.stderr.slice(0,300)}`);
            // Child close proves direct-child completion only. Never mark descendants terminated.
            return {stdout:observed.stdout};
          })()
        : await execFileAsync(launcher,[...launcherPrefix,...args],{
            cwd:options.session.workspace,env:childEnv,timeout:timeoutMs,maxBuffer:10*1024*1024,encoding:"utf8"
          });
      payload = parseResult(String(stdout));
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Claude Code CLI route failed";
      const timedOut = /timed out|ETIMEDOUT/i.test(detail);
      attempts.push({
        routeNumber,
        transportModelAlias: route,
        actualRuntimeModel: null,
        outcome: timedOut ? "timeout" : "failed",
        error: detail,
        latencyMs: Date.now() - attemptStartedAt,
      });
      // A Claude CLI failure is only safe to reroute when it left the durable native
      // session untouched. Replaying the same prompt after Claude already appended it
      // can duplicate tool work and triggers Claude's resume/continuation machinery.
      const nativeAfter = await nativeClaudeSessionSnapshot(options.session.claudeSessionId);
      if (nativeClaudeSessionChanged(nativeBefore, nativeAfter)) {
        createSession = false;
        if (await nativeChangeWasPromptOnly(nativeBefore, nativeAfter)) {
          lastError = `${detail}; the route recorded only the prompt (nothing executed), next route tried`;
          continue;
        }
        retrySuppressed = true;
        lastError = `${detail}; retry suppressed because the persistent Claude Code session changed during the failed route`;
        break;
      }
      lastError = detail;
      continue;
    }

    lastPayload = payload;
    if (payload.session_id !== options.session.claudeSessionId) {
      throw new Error("Claude Code CLI returned an unexpected session ID");
    }
    createSession = false;
    // The transport route is the route selected for this exact attempt.
    // payload.modelUsage may contain stale/resumed-session model keys and is not
    // authoritative transport provenance for the current turn.
    const successfulTransportModelAlias = toGatewayModel(route);
    const denials = Array.isArray(payload.permission_denials) ? payload.permission_denials.length : 0;
    const resultText = typeof payload.result === "string" ? payload.result.trim() : "";
    const gatewayFailure = payload.is_error || !resultText || /^Provider API request failed\.?/i.test(resultText);

    attempts.push({
      routeNumber,
      transportModelAlias: route,
      actualRuntimeModel: null,
      outcome: gatewayFailure ? "upstream_provider_failed" : "completed",
      error: gatewayFailure ? resultText || "Claude Code CLI turn failed" : null,
      latencyMs: Date.now() - attemptStartedAt,
    });

    if (gatewayFailure) {
      // A Claude CLI failure is only safe to reroute when it left the durable native
      // session untouched. Replaying the same prompt after Claude already appended it
      // can duplicate tool work and triggers Claude's resume/continuation machinery.
      const nativeAfter = await nativeClaudeSessionSnapshot(options.session.claudeSessionId);
      if (nativeClaudeSessionChanged(nativeBefore, nativeAfter) && await nativeChangeWasPromptOnly(nativeBefore, nativeAfter)) {
        createSession = false;
        lastError = `${resultText || "Claude Code CLI turn failed"}; the route recorded only the prompt (nothing executed), next route tried`;
        continue;
      }
      if (nativeClaudeSessionChanged(nativeBefore, nativeAfter)) {
        retrySuppressed = true;
        lastError = `${resultText || "Claude Code CLI turn failed"}; retry suppressed because the persistent Claude Code session changed during the failed route`;
        break;
      }
      lastError = resultText || "Claude Code CLI turn failed";
      continue;
    }

    return {
      status: "completed",
      text: resultText,
      error: null,
      transportModelAlias: successfulTransportModelAlias,
      actualRuntimeModel: null,
      attempts,
      routeCount: routeReadiness.routeCount,
      skippedRouteNumbers: [],
      agentIdentity: "Claude Code",
      agentRuntime: "Claude Code CLI",
      installedVersion,
      provider: null,
      runtimeVerifiedAt,
      responseProvenance: "Claude Code CLI -> FCC transport route -> persistent Claude Code session; backing model only when machine-readable",
      agentSessionId: payload.session_id,
      workspace: options.session.workspace,
      sessionState: "idle",
      executionMode: options.session.executionMode,
      permissionMode: `${options.session.permissionMode}${denials > 0 ? ` (${denials} denied tool requests)` : ""}`,
      cliPayload: payload,
    };
  }

  const attemptedNumbers = new Set(attempts.map((attempt) => attempt.routeNumber));
  return {
    status: "failed",
    text: null,
    error: retrySuppressed ? lastError : `${lastError}; all available Claude Code agent routes failed`,
    transportModelAlias: attempts.at(-1)?.transportModelAlias,
    actualRuntimeModel: null,
    attempts,
    routeCount: routeReadiness.routeCount,
    skippedRouteNumbers: FALLBACK_MODEL_ROUTES.map((_, index) => index + 1).filter(
      (routeNumber) => !attemptedNumbers.has(routeNumber)
    ),
    agentIdentity: "Claude Code",
    agentRuntime: "Claude Code CLI",
    installedVersion,
    provider: null,
    runtimeVerifiedAt,
    responseProvenance: "Claude Code CLI -> FCC transport route -> persistent Claude Code session; backing model only when machine-readable",
    agentSessionId: options.session.claudeSessionId,
    workspace: options.session.workspace,
    sessionState: "error",
    executionMode: options.session.executionMode,
    permissionMode: options.session.permissionMode,
    cliPayload: lastPayload,
  };
}
