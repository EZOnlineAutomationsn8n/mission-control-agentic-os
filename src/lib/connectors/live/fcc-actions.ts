import type { FccAskResult, FccAttemptOutcome, FccModelAttempt } from "./fcc-actions-types";

// ─────────────────────────────────────────────────────────────────────────
// SERVER-ONLY. Must only be imported from a server context (the API route
// below). Never import it from a "use client" component.
//
// One-time, explicitly-scoped controlled prompt for Free Claude Code (FCC)
// only: the operator submits a single plain-text prompt to FCC's own
// Anthropic-compatible /v1/messages endpoint and reads back the plain text
// answer. This is NOT a general command-execution channel and NOT a Claude
// Code agent session:
//   - no `tools` / `tool_choice` field is ever sent — the request/response
//     is a bare text completion; nothing is executed as a result
//   - no filesystem writes, no shell invocation, no service restart, no
//     tmux/session attach happen anywhere in this module
//   - only triggered by an explicit POST from the UI form — nothing polls
//     or schedules calls to this function
//   - no API key is read or sent (FCC's local auth dependency is a no-op
//     while ANTHROPIC_AUTH_TOKEN is unset on this host)
//
// ROUTING CONTRACT (operator-controlled):
//   - FALLBACK_MODEL_ROUTES below is the OPERATOR-DEFINED, FREE-only route
//     order. Its contents and order are never changed by code.
//   - Routes are numbered 1..N in that order, and every attempt reports
//     its operator route number to the UI.
//   - One optimization is allowed: the route that answered most recently
//     (lastGoodRoute) is TRIED first to avoid burning the budget on known-
//     failing routes — but it keeps its operator route number, the attempt
//     is flagged `lastKnownGood`, and the displayed order stays 1..N.
//   - Per-route timeout and a total chain budget keep the action from
//     hanging the UI; when the budget runs out, the not-attempted route
//     numbers are reported as skipped, never hidden.
//
// Transport alias vs. actual runtime model: every route is a transport
// string FCC's router remaps; FCC reports the real backing model in
// `message_start.message.model`. Both are surfaced — the UI must present
// answers as raw model output from that runtime model, never as a Claude
// Code agent.
// ─────────────────────────────────────────────────────────────────────────

const FCC_MESSAGES_URL = process.env.FCC_MESSAGES_URL || "http://127.0.0.1:8082/v1/messages";
const PER_ROUTE_TIMEOUT_MS = 8000;
const TOTAL_BUDGET_MS = 60000;
const MAX_PROMPT_LENGTH = 4000;

// OPERATOR-DEFINED FREE-only route order. Do not reorder or edit in code
// passes — this list belongs to the operator (locked in commit 4af1aaf).
export const FALLBACK_MODEL_ROUTES: readonly string[] = [
  // Operator-approved FREE-only routes verified from live FCC /v1/models
  // on 2026-07-17. Keep this FCC order code-first and different from the
  // OpenClaw order so both runtimes do not exhaust the same route together.
  "open_router/poolside/laguna-xs-2.1:free",
  "open_router/cohere/north-mini-code:free",
  "open_router/nvidia/nemotron-3-nano-30b-a3b:free",
  "open_router/nvidia/nemotron-3-super-120b-a12b:free",
  "open_router/nvidia/nemotron-nano-9b-v2:free",
  "open_router/nvidia/nemotron-nano-12b-v2-vl:free",
  "open_router/nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "open_router/google/gemma-4-26b-a4b-it:free",
  "open_router/google/gemma-4-31b-it:free",
  "open_router/openai/gpt-oss-20b:free",
  "open_router/nvidia/nemotron-3-ultra-550b-a55b:free",
  "open_router/openrouter/free",
];

/** Exported so callers (e.g. the route handler's own error paths) never hardcode this number. */
export const FCC_ROUTE_COUNT = FALLBACK_MODEL_ROUTES.length;

// Last route that produced a real answer (module-scope; survives across
// requests within one server process). Optimization only — see contract.
let lastGoodRoute: string | null = null;

// Observed upstream/provider failure text FCC streams back as ordinary
// text_delta content (it does not use a distinct SSE error event type for
// this). Matching this lets us classify the action outcome correctly
// instead of reporting a provider-side failure as a successful answer.
const UPSTREAM_PROVIDER_ERROR_PATTERN =
  /provider api request failed|provider rate limit reached|rate limit reached|rate limited|quota exceeded|temporarily unavailable/i;

function preflightFailure(error: string): FccAskResult {
  return {
    status: "failed",
    text: null,
    error,
    transportModelAlias: FALLBACK_MODEL_ROUTES[0],
    actualRuntimeModel: null,
    attempts: [],
    routeCount: FALLBACK_MODEL_ROUTES.length,
    skippedRouteNumbers: [],
    timestamp: new Date().toISOString(),
  };
}

/**
 * Native-stage transport attestation: the existing FCC Python stage guard
 * is tested as source, but has NOT been shown to protect the effective
 * Claude CLI/FCC listener on this preview. Until the *running listener*
 * supplies independently verifiable proof, refuse before ANY dispatch.
 * This is not a second route catalog or a substitute for the FCC guard.
 * LIVE has exactly its former behavior. No environment flag can self-attest.
 */
export function stageFccPreDispatchVerdict(): {canDispatch:boolean;code:string} {
  if(process.env.MC_PREVIEW !== "1")return {canDispatch:true,code:"NOT_STAGE"};
  return {canDispatch:false,code:"FCC_STAGE_NATIVE_GUARD_NOT_EFFECTIVE"};
}

export async function sendFccControlledPrompt(prompt: unknown): Promise<FccAskResult> {
  const stageGate=stageFccPreDispatchVerdict();
  if(!stageGate.canDispatch)return preflightFailure(stageGate.code);
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return preflightFailure("prompt must be non-empty text");
  }
  const trimmed = prompt.trim().slice(0, MAX_PROMPT_LENGTH);

  // Try order: last-good route first (if any), then the operator order
  // minus that route. Route numbers always reflect the operator order.
  const tryOrder: { route: string; routeNumber: number; lastKnownGood: boolean }[] = [];
  if (lastGoodRoute && FALLBACK_MODEL_ROUTES.includes(lastGoodRoute)) {
    tryOrder.push({
      route: lastGoodRoute,
      routeNumber: FALLBACK_MODEL_ROUTES.indexOf(lastGoodRoute) + 1,
      lastKnownGood: true,
    });
  }
  FALLBACK_MODEL_ROUTES.forEach((route, i) => {
    if (route !== lastGoodRoute) tryOrder.push({ route, routeNumber: i + 1, lastKnownGood: false });
  });

  const attempts: FccModelAttempt[] = [];
  const startedAt = Date.now();

  for (const entry of tryOrder) {
    const elapsed = Date.now() - startedAt;
    const remaining = TOTAL_BUDGET_MS - elapsed;
    if (remaining < 1000) break; // budget exhausted — stop honestly, report skipped routes

    const attempt = await tryOneRoute(entry, trimmed, Math.min(PER_ROUTE_TIMEOUT_MS, remaining));
    attempts.push(attempt.record);

    if (attempt.record.outcome === "completed") {
      lastGoodRoute = entry.route;
      return {
        status: "completed",
        text: attempt.text,
        error: null,
        transportModelAlias: entry.route,
        actualRuntimeModel: attempt.record.actualRuntimeModel,
        attempts,
        routeCount: FALLBACK_MODEL_ROUTES.length,
        skippedRouteNumbers: [],
        timestamp: new Date().toISOString(),
      };
    }
  }

  // Every attempted route failed (or the budget ran out). Never report
  // this as success — return the full per-route evidence plus the exact
  // route numbers that were never attempted.
  const attemptedNumbers = new Set(attempts.map((a) => a.routeNumber));
  const skippedRouteNumbers = FALLBACK_MODEL_ROUTES.map((_, i) => i + 1).filter((n) => !attemptedNumbers.has(n));
  const budgetSpentS = Math.round((Date.now() - startedAt) / 1000);

  return {
    status: "action_required",
    text: null,
    error:
      skippedRouteNumbers.length > 0
        ? `no route answered within the ${Math.round(TOTAL_BUDGET_MS / 1000)}s chain budget (${budgetSpentS}s spent) — routes ${skippedRouteNumbers.join(", ")} not attempted; see attempts for exact per-route errors`
        : "all configured model routes failed — see attempts for exact per-route errors",
    transportModelAlias: attempts[attempts.length - 1]?.transportModelAlias ?? FALLBACK_MODEL_ROUTES[0],
    actualRuntimeModel: null,
    attempts,
    routeCount: FALLBACK_MODEL_ROUTES.length,
    skippedRouteNumbers,
    timestamp: new Date().toISOString(),
  };
}

async function tryOneRoute(
  entry: { route: string; routeNumber: number; lastKnownGood: boolean },
  prompt: string,
  timeoutMs: number
): Promise<{ record: FccModelAttempt; text: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const t0 = Date.now();

  const base = {
    routeNumber: entry.routeNumber,
    transportModelAlias: entry.route,
    ...(entry.lastKnownGood ? { lastKnownGood: true } : {}),
  };

  try {
    const res = await fetch(FCC_MESSAGES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: entry.route,
        max_tokens: 512,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok || !res.body) {
      return {
        text: null,
        record: {
          ...base,
          actualRuntimeModel: null,
          outcome: "failed",
          error: `FCC returned HTTP ${res.status}`,
          latencyMs: Date.now() - t0,
        },
      };
    }

    const { text, actualRuntimeModel } = await readAnthropicSseResponse(res.body);

    if (text === null) {
      return {
        text: null,
        record: {
          ...base,
          actualRuntimeModel,
          outcome: "failed",
          error: "no text content returned by FCC",
          latencyMs: Date.now() - t0,
        },
      };
    }

    const outcome: FccAttemptOutcome = UPSTREAM_PROVIDER_ERROR_PATTERN.test(text)
      ? "upstream_provider_failed"
      : "completed";

    return {
      text: outcome === "completed" ? text : null,
      record: {
        ...base,
        actualRuntimeModel,
        outcome,
        error: outcome === "upstream_provider_failed" ? `upstream provider error: ${text}` : null,
        latencyMs: Date.now() - t0,
      },
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      text: null,
      record: {
        ...base,
        actualRuntimeModel: null,
        outcome: aborted ? "timeout" : "failed",
        error: aborted
          ? `request timed out after ${Math.round(timeoutMs / 1000)}s`
          : e instanceof Error
            ? e.message
            : "request failed",
        latencyMs: Date.now() - t0,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Parses an Anthropic-style SSE stream: concatenates text_delta content and
 * captures the real backing model name reported in message_start, if any.
 */
async function readAnthropicSseResponse(
  body: ReadableStream<Uint8Array>
): Promise<{ text: string | null; actualRuntimeModel: string | null }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let gotAny = false;
  let actualRuntimeModel: string | null = null;

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const parsed = JSON.parse(payload) as {
            type?: string;
            message?: { model?: unknown };
            delta?: { type?: string; text?: string };
          };
          if (parsed.type === "message_start" && typeof parsed.message?.model === "string") {
            actualRuntimeModel = parsed.message.model;
          }
          if (
            parsed.type === "content_block_delta" &&
            parsed.delta?.type === "text_delta" &&
            typeof parsed.delta.text === "string"
          ) {
            text += parsed.delta.text;
            gotAny = true;
          }
        } catch {
          // ignore malformed/partial SSE lines
        }
      }
    }
  }

  return { text: gotAny ? text : null, actualRuntimeModel };
}
