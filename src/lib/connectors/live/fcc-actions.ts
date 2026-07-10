import type { FccAskResult, FccAttemptOutcome, FccModelAttempt } from "./fcc-actions-types";

// ─────────────────────────────────────────────────────────────────────────
// SERVER-ONLY. Must only be imported from a server context (the API route
// below). Never import it from a "use client" component.
//
// One-time, explicitly-scoped controlled override for FCC / OwlAlpha only:
// allows the operator to submit a single plain-text prompt to FCC's own
// Anthropic-compatible /v1/messages endpoint and read back the plain text
// answer. This is NOT a general command-execution channel:
//   - no `tools` / `tool_choice` field is ever sent — FCC's proxy has no
//     tool-execution loop of its own; the request/response here is a bare
//     text completion, nothing is executed as a result of the response
//   - no filesystem writes, no shell invocation, no service restart, no
//     tmux/session attach happen anywhere in this module
//   - only triggered by an explicit POST from the UI form — no background
//     polling or scheduled invocation calls this function
//   - no API key is read or sent: recon confirmed ANTHROPIC_AUTH_TOKEN is
//     unset on this host, which makes FCC's own auth dependency a no-op
//     (see api/dependencies.py: require_api_key allows all requests when
//     the token is empty) — if that ever changes, this call would start
//     failing with 401, not silently start reading a secret
//
// Fallback model routes: FCC's default MODEL (mapped from the plain Claude
// alias below) currently routes to the OpenRouter free lane's
// "owl-alpha" backing model, which was observed failing with
// "Provider API request failed" during recon. FCC's own model router
// (api/model_router.py) also accepts a direct "<provider_id>/<provider_model>"
// string, bypassing that default mapping — confirmed via this host's own
// GET /v1/models catalog (public model list, no secret). Two known-good
// routes from that catalog are tried next, in order, before giving up.
// Nothing here is invented: every route below was smoke-tested live
// against this exact FCC instance before being wired in.
//
// Transport alias vs. actual runtime model: every route we send is a
// transport-level string FCC's router remaps; FCC's response reports the
// real backing model it actually used in `message_start.message.model`.
// The two are always kept as separate fields — the UI must show the
// actual runtime model, never the transport alias, as "what FCC ran on."
// ─────────────────────────────────────────────────────────────────────────

const FCC_MESSAGES_URL = "http://127.0.0.1:8082/v1/messages";
const REQUEST_TIMEOUT_MS = 30000;
const MAX_PROMPT_LENGTH = 4000;

// Tried in order; first "completed" outcome wins. Each is a route this
// FCC instance actually resolves today (verified live, not assumed):
//   1. the standard Claude alias -> FCC's configured default MODEL
//   2/3. direct "open_router/<vendor>/<model>" routes from this host's own
//      GET /v1/models catalog, bypassing the (currently broken) default.
const FALLBACK_MODEL_ROUTES: readonly string[] = [
  // FREE-only routes verified from live FCC /v1/models.
  "open_router/openrouter/owl-alpha",
  "open_router/qwen/qwen3-coder:free",
  "open_router/poolside/laguna-m.1:free",
  "open_router/cohere/north-mini-code:free",
  "open_router/qwen/qwen3-next-80b-a3b-instruct:free",
  "open_router/openai/gpt-oss-120b:free",
  "open_router/nvidia/nemotron-3-ultra-550b-a55b:free",
  "open_router/google/gemma-4-31b-it:free",
  "open_router/openai/gpt-oss-20b:free",
  "open_router/openrouter/free",
];

// Observed upstream/provider failure text FCC streams back as ordinary
// text_delta content (it does not use a distinct SSE error event type for
// this). Matching this lets us classify the action outcome correctly
// instead of reporting a provider-side failure as a successful answer.
const UPSTREAM_PROVIDER_ERROR_PATTERN = /provider api request failed|provider rate limit reached|rate limit reached|rate limited|quota exceeded|temporarily unavailable/i;

function preflightFailure(error: string): FccAskResult {
  return {
    status: "failed",
    text: null,
    error,
    transportModelAlias: FALLBACK_MODEL_ROUTES[0],
    actualRuntimeModel: null,
    attempts: [],
    timestamp: new Date().toISOString(),
  };
}

export async function sendFccControlledPrompt(prompt: unknown): Promise<FccAskResult> {
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return preflightFailure("prompt must be non-empty text");
  }
  const trimmed = prompt.trim().slice(0, MAX_PROMPT_LENGTH);

  const attempts: FccModelAttempt[] = [];

  for (const route of FALLBACK_MODEL_ROUTES) {
    const attempt = await tryOneRoute(route, trimmed);
    attempts.push(attempt.record);

    if (attempt.record.outcome === "completed") {
      return {
        status: "completed",
        text: attempt.text,
        error: null,
        transportModelAlias: route,
        actualRuntimeModel: attempt.record.actualRuntimeModel,
        attempts,
        timestamp: new Date().toISOString(),
      };
    }
    // A failure on one route still means the others are worth trying —
    // only the aggregate "all routes exhausted" case below gives up.
  }

  // Every configured route failed. Never report this as a successful
  // completion — surface it as an explicit action-required state with the
  // full per-route evidence, so the operator can act instead of being
  // told a fake success.
  return {
    status: "action_required",
    text: null,
    error: "all configured model routes failed — see attempts for exact per-route errors",
    transportModelAlias: attempts[attempts.length - 1]?.transportModelAlias ?? FALLBACK_MODEL_ROUTES[0],
    actualRuntimeModel: null,
    attempts,
    timestamp: new Date().toISOString(),
  };
}

async function tryOneRoute(
  transportModelAlias: string,
  prompt: string
): Promise<{ record: FccModelAttempt; text: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(FCC_MESSAGES_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: transportModelAlias,
        max_tokens: 512,
        stream: true,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!res.ok || !res.body) {
      return {
        text: null,
        record: {
          transportModelAlias,
          actualRuntimeModel: null,
          outcome: "failed",
          error: `FCC returned HTTP ${res.status}`,
        },
      };
    }

    const { text, actualRuntimeModel } = await readAnthropicSseResponse(res.body);

    if (text === null) {
      return {
        text: null,
        record: {
          transportModelAlias,
          actualRuntimeModel,
          outcome: "failed",
          error: "no text content returned by FCC",
        },
      };
    }

    const outcome: FccAttemptOutcome = UPSTREAM_PROVIDER_ERROR_PATTERN.test(text)
      ? "upstream_provider_failed"
      : "completed";

    return {
      text: outcome === "completed" ? text : null,
      record: {
        transportModelAlias,
        actualRuntimeModel,
        outcome,
        error: outcome === "upstream_provider_failed" ? `upstream provider error: ${text}` : null,
      },
    };
  } catch (e) {
    const aborted = e instanceof Error && e.name === "AbortError";
    return {
      text: null,
      record: {
        transportModelAlias,
        actualRuntimeModel: null,
        outcome: aborted ? "timeout" : "failed",
        error: aborted ? "request timed out" : e instanceof Error ? e.message : "request failed",
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
