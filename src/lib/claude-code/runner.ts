import { execFile } from "child_process";
import { promisify } from "util";
import type { ConnectorConversationResult } from "@/lib/agent-conversations/service";
import type { ClaudeCodeSession } from "./session-store";
import { FALLBACK_MODEL_ROUTES, sendFccControlledPrompt } from "@/lib/connectors/live/fcc-actions";
import type { FccModelAttempt } from "@/lib/connectors/live/fcc-actions-types";

const execFileAsync = promisify(execFile);
const DEFAULT_LAUNCHER = "/opt/vireon/workfloor/bin/start_claude_fcc.sh";
function toGatewayModel(route: string): string {
  return `claude-3-freecc-no-thinking/${route}`;
}
const IDENTITY_CONTEXT =
  "You are the Claude Code agent running inside the Mission Control Claude Code Agent Terminal. " +
  "Your agent identity is Claude Code. FCC is only the underlying model gateway. " +
  "Never present a backing fallback model as your agent identity. FCC is provider-agnostic and may route to non-Anthropic models. The Claude Code CLI does not report the actual backing runtime model here, so call it unknown unless explicit machine-readable evidence is provided. Distinguish agent identity, CLI runtime, FCC gateway alias, and backing model.";

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
  const launcher = process.env.CLAUDE_CODE_LAUNCHER || DEFAULT_LAUNCHER;
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
      agentRuntime: "Claude Code CLI 2.1.205",
      agentSessionId: options.session.claudeSessionId,
      workspace: options.session.workspace,
      sessionState: "error",
      executionMode: options.session.executionMode,
      permissionMode: options.session.permissionMode,
      cliPayload: {},
    };
  }
  const preflightFailures = new Set(
    routeReadiness.attempts
      .filter((attempt) => attempt.outcome !== "completed")
      .map((attempt) => attempt.transportModelAlias)
  );
  const routes = [
    routeReadiness.transportModelAlias,
    ...FALLBACK_MODEL_ROUTES.filter(
      (route) => route !== routeReadiness.transportModelAlias && !preflightFailures.has(route)
    ),
  ];
  const attempts = [...routeAttempts];
  const totalTimeoutMs = Number(process.env.CLAUDE_CODE_TIMEOUT_MS || 180_000);
  const perRouteTimeoutMs = Number(process.env.CLAUDE_CODE_ROUTE_TIMEOUT_MS || 45_000);
  const startedAt = Date.now();
  let createSession = options.create;
  let lastPayload: ClaudeCliPayload = {};
  let lastError = "all Claude Code agent routes failed";

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
      "--model", gatewayModel,
      createSession ? "--session-id" : "--resume", options.session.claudeSessionId,
      options.prompt,
    ];

    let payload: ClaudeCliPayload;
    try {
      const { stdout } = await execFileAsync(launcher, args, {
        cwd: options.session.workspace,
        env: {
          ...process.env,
          CLAUDE_WORKDIR: options.session.workspace,
          CLAUDE_BARE: "0",
          CLAUDE_QUIET: "1",
          CLAUDE_MODEL: process.env.CLAUDE_CODE_MODEL || gatewayModel,
        },
        timeout: Math.min(perRouteTimeoutMs, remainingMs),
        maxBuffer: 10 * 1024 * 1024,
        encoding: "utf8",
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
      lastError = detail;
      continue;
    }

    lastPayload = payload;
    if (payload.session_id !== options.session.claudeSessionId) {
      throw new Error("Claude Code CLI returned an unexpected session ID");
    }
    createSession = false;
    const modelAlias = Object.keys(payload.modelUsage ?? {})[0] ?? gatewayModel;
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
      lastError = resultText || "Claude Code CLI turn failed";
      continue;
    }

    return {
      status: "completed",
      text: resultText,
      error: null,
      transportModelAlias: modelAlias,
      actualRuntimeModel: null,
      attempts,
      routeCount: routeReadiness.routeCount,
      skippedRouteNumbers: [],
      agentIdentity: "Claude Code",
      agentRuntime: "Claude Code CLI 2.1.205",
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
    error: `${lastError}; all available Claude Code agent routes failed`,
    transportModelAlias: attempts.at(-1)?.transportModelAlias,
    actualRuntimeModel: null,
    attempts,
    routeCount: routeReadiness.routeCount,
    skippedRouteNumbers: FALLBACK_MODEL_ROUTES.map((_, index) => index + 1).filter(
      (routeNumber) => !attemptedNumbers.has(routeNumber)
    ),
    agentIdentity: "Claude Code",
    agentRuntime: "Claude Code CLI 2.1.205",
    agentSessionId: options.session.claudeSessionId,
    workspace: options.session.workspace,
    sessionState: "error",
    executionMode: options.session.executionMode,
    permissionMode: options.session.permissionMode,
    cliPayload: lastPayload,
  };
}
