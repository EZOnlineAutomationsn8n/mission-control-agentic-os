import type { N8nTriggerResult } from "./n8n-actions-types";

// ─────────────────────────────────────────────────────────────────────────
// SERVER-ONLY. n8n workflowTrigger action — inert unless a safe
// test/demo webhook is explicitly configured below.
//
// Discovery performed (read-only, no credentials):
//   - GET /rest/workflows -> 401 (requires an API key/session we don't have
//     and won't read — listing workflows is off the table without secrets)
//   - GET /webhook/ping, /webhook-test/ping -> 404 (no known safe webhook
//     path exists; guessing arbitrary paths risks firing a real workflow
//     with unknown side effects, which is unsafe)
//
// Since no safe trigger surface could be discovered without reading
// credentials, this stays an app-local disabled placeholder: the action
// endpoint exists and is wired end-to-end (real POST route, real capability
// entry, real UI), but always reports "blocked" with the exact missing
// requirement until an operator explicitly sets SAFE_WEBHOOK_PATH below to
// a known test/demo workflow's public webhook path.
// ─────────────────────────────────────────────────────────────────────────

const SAFE_WEBHOOK_PATH: string | null = null;
const WEBHOOK_BASE = "http://127.0.0.1:5678/webhook";
const REQUEST_TIMEOUT_MS = 5000;

export async function triggerN8nWorkflow(): Promise<N8nTriggerResult> {
  const timestamp = new Date().toISOString();

  if (!SAFE_WEBHOOK_PATH) {
    return {
      status: "blocked",
      text: null,
      error:
        "no safe test/demo webhook discovered — requires an n8n workflow with a public webhook trigger path configured (SAFE_WEBHOOK_PATH); none is set",
      timestamp,
    };
  }

  // Not reached until an operator explicitly configures a safe path above.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${WEBHOOK_BASE}/${SAFE_WEBHOOK_PATH}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ source: "agentic-os-mission-control", kind: "test-trigger" }),
    });
    const text = await res.text().catch(() => null);
    if (!res.ok) {
      return { status: "failed", text: null, error: `webhook returned HTTP ${res.status}`, timestamp };
    }
    return { status: "completed", text: text?.slice(0, 500) ?? "triggered", error: null, timestamp };
  } catch (e) {
    return {
      status: "failed",
      text: null,
      error: e instanceof Error ? e.message : "request failed",
      timestamp,
    };
  } finally {
    clearTimeout(timer);
  }
}
