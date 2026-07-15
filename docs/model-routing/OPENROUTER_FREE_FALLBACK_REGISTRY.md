# OpenRouter FREE Fallback Registry

Date: 2026-07-10  
Scope: Mission Control FCC connector route  
Status: verified on VPS runtime

Rule: FREE-only. No Haiku, no Fable, no paid Anthropic Sonnet/Opus fallback.

---

## Verified Mission Control FCC fallback order

This order is sourced from the live FCC `/v1/models` fact-lock and applied in:

- `src/lib/connectors/live/fcc-actions.ts`
- `src/app/api/connectors/fcc/actions/ask/route.ts`

Fallback order:

1. `open_router/poolside/laguna-m.1:free`
2. `open_router/qwen/qwen3-coder:free`
3. `open_router/cohere/north-mini-code:free`
4. `open_router/qwen/qwen3-next-80b-a3b-instruct:free`
5. `open_router/openai/gpt-oss-120b:free`
6. `open_router/nvidia/nemotron-3-ultra-550b-a55b:free`
7. `open_router/google/gemma-4-31b-it:free`
8. `open_router/openai/gpt-oss-20b:free`
9. `open_router/openrouter/free`

---

## Forbidden fallback routes

These must not appear in the active Mission Control FCC fallback chain:

- `claude-3-5-sonnet-20241022`
- `open_router/anthropic/claude-haiku-4.5`
- `open_router/anthropic/claude-fable-5`
- any hardcoded Haiku fallback
- any hardcoded Fable fallback
- any paid Sonnet fallback
- any paid Opus fallback

---

## Runtime behavior

Required behavior:

1. Mission Control uses only the verified FREE-only fallback list.
2. Provider failures are classified as failed attempts.
3. Provider rate-limit responses are classified as failed attempts.
4. Timeout responses are classified as failed attempts.
5. If all FREE routes fail, Mission Control returns `action_required`.
6. Mission Control must not silently fall back to a paid model.

---

## Verified runtime proof

Runtime proof on 2026-07-10:

- The unavailable former primary route was removed from active routing on 2026-07-13; historical runtime evidence remains preserved.
- `open_router/qwen/qwen3-coder:free` failed as provider rate-limit.
- several FREE routes timed out.
- `open_router/google/gemma-4-31b-it:free` failed as provider rate-limit.
- final result: `action_required`.
- hard check result: `PASS: FREE-ONLY FALLBACK EXHAUSTED WITHOUT PAID MODELS`.

This is valid behavior: fail safe instead of silently using a paid fallback.

---

## Commit reference

Implementation commit:

- `4af1aaf Lock FCC Mission Control fallback to free-only routes`
